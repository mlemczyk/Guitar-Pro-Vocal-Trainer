import { loadScore, vocalCandidates, buildSong, phraseText, type Song } from "./song";
import type * as at from "@coderline/alphatab";
import { Player } from "./player";
import { PitchTracker, listInputs } from "./pitch";
import { Judge } from "./scoring";
import { View, TunerView, type TrailPoint } from "./view";
import { measure, offsetFromRoundTrip, type CalibMode } from "./calibrate";
import { saveAttempt, attemptsFor, allAttempts, importAttempts, summarise, phraseRates, type Attempt } from "./stats";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  file: $<HTMLInputElement>("file"), track: $<HTMLSelectElement>("track"),
  play: $<HTMLButtonElement>("play"), restart: $<HTMLButtonElement>("restart"),
  seek: $<HTMLInputElement>("seek"), time: $("time"),
  speed: $<HTMLInputElement>("speed"), speedVal: $("speedVal"),
  octave: $<HTMLSelectElement>("octave"), guide: $<HTMLInputElement>("guide"), bandVol: $<HTMLInputElement>("bandVol"),
  micBtn: $<HTMLButtonElement>("micBtn"), mic: $<HTMLSelectElement>("mic"),
  statsBtn: $<HTMLButtonElement>("statsBtn"), setBtn: $<HTMLButtonElement>("setBtn"), tuneBtn: $<HTMLButtonElement>("tuneBtn"),
  stats: $("stats"), settings: $("settings"), calib: $("calib"),
  rangeReset: $<HTMLButtonElement>("rangeReset"), calSing: $<HTMLButtonElement>("calSing"), calLoop: $<HTMLButtonElement>("calLoop"),
  calStatus: $("calStatus"), calCurrent: $("calCurrent"),
  offset: $<HTMLInputElement>("offset"), offsetVal: $("offsetVal"),
  tol: $<HTMLInputElement>("tol"), tolVal: $("tolVal"), fold: $<HTMLInputElement>("fold"),
  ahead: $<HTMLInputElement>("ahead"), aheadVal: $("aheadVal"), sens: $<HTMLInputElement>("sens"),
  micInfo: $("micInfo"), toast: $("toast"), canvas: $<HTMLCanvasElement>("roll"),
};

// ---- per-viewer preferences (best effort; the app works without storage)
const PREFS = "vocals-trainer-prefs";
// The mic offset is kept per input device: each mic and interface has its own latency.
let offsets: Record<string, string> = {};
const micKey = () => ui.mic.value || "default";
function loadPrefs(): Record<string, any> {
  try { return JSON.parse(localStorage.getItem(PREFS) || "{}"); } catch { return {}; }
}
function savePrefs(): void {
  offsets[micKey()] = ui.offset.value;
  const p = { speed: ui.speed.value, octave: ui.octave.value, guide: ui.guide.checked, band: ui.bandVol.value,
    offset: ui.offset.value, offsets, tol: ui.tol.value, fold: ui.fold.checked, ahead: ui.ahead.value, sens: ui.sens.value, mic: ui.mic.value };
  try { localStorage.setItem(PREFS, JSON.stringify(p)); } catch { /* storage blocked */ }
}
{
  const p = loadPrefs();
  for (const k of ["speed", "octave", "offset", "tol", "ahead", "sens"] as const) if (typeof p[k] === "string") (ui[k] as HTMLInputElement).value = p[k] as string;
  if (typeof p.band === "string") ui.bandVol.value = p.band;
  if (typeof p.guide === "boolean") ui.guide.checked = p.guide;
  if (typeof p.fold === "boolean") ui.fold.checked = p.fold;
  if (p.offsets && typeof p.offsets === "object") offsets = p.offsets;
}
function applyMicOffset(): void {
  const o = offsets[micKey()];
  if (o !== undefined) { ui.offset.value = o; syncLabels(); }
  ui.calCurrent.textContent = `Offset for this mic: ${ui.offset.value} ms.`;
}

const player = new Player();
const tracker = new PitchTracker(player.ctx);
const view = new View(ui.canvas);
const tunerView = new TunerView(ui.canvas);
if (import.meta.env.DEV) (window as any).__vt = { player, tracker, get song() { return song; }, get judge() { return judge; } };

let score: at.model.Score | null = null;
let fileName = "";
let song: Song | null = null;
let judge: Judge | null = null;
let trail: TrailPoint[] = [];
let streak = 0;
let lastClosed = -1;
let attemptStart = 0;
let saved = false;
let lastT = 0;

function toast(msg: string, ms = 3500): void {
  ui.toast.textContent = msg;
  ui.toast.hidden = false;
  clearTimeout((toast as any).timer);
  (toast as any).timer = setTimeout(() => (ui.toast.hidden = true), ms);
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ---- loading
async function openFile(f: File): Promise<void> {
  await commitAttempt();
  try {
    score = loadScore(new Uint8Array(await f.arrayBuffer()));
  } catch (e) {
    toast(`Could not read ${f.name}: ${e}`);
    return;
  }
  fileName = f.name;
  const cands = vocalCandidates(score);
  ui.track.innerHTML = "";
  for (const c of cands) {
    const o = document.createElement("option");
    o.value = String(c.index);
    o.textContent = `${c.name || "Track " + (c.index + 1)}${c.lyricBeats ? ` · ${c.lyricBeats} lyrics` : " · no lyrics"}`;
    ui.track.append(o);
  }
  ui.track.disabled = cands.length === 0;
  if (!cands.length) { toast("No pitched tracks in this file."); return; }
  if (!cands[0].lyricBeats) toast("No track in this file has lyrics; pick the vocal melody track by hand.", 6000);
  await selectTrack(cands[0].index);
}

async function selectTrack(index: number): Promise<void> {
  if (!score) return;
  await commitAttempt();
  ui.play.disabled = ui.restart.disabled = ui.seek.disabled = true;
  player.stop();
  ui.play.textContent = "▶";
  song = buildSong(score, index, fileName);
  ui.track.value = String(index);
  await player.load(song);
  player.setRate(+ui.speed.value);
  judge = new Judge(song, { toleranceCents: +ui.tol.value, hitFraction: 0.4 });
  resetRun(0);
  ui.play.disabled = ui.restart.disabled = ui.seek.disabled = false;
  ui.seek.max = String(player.duration);
  if (!song.backingAudio) toast("This tab has no backing track; only the guide tone will play.", 6000);
  document.title = `${song.title} · Vocals Trainer`;
  if (!ui.stats.hidden) void renderStats();
}

function resetRun(from: number): void {
  judge?.reset(from);
  trail = [];
  streak = 0;
  lastClosed = -1;
  attemptStart = from;
  saved = false;
}

// ---- saving attempts
async function commitAttempt(): Promise<void> {
  if (!song || !judge || saved) return;
  const s = judge.summary();
  if (s.judged < 8) return;
  const t = player.position();
  const a: Attempt = {
    songKey: song.key, title: song.title, artist: song.artist, track: song.trackName,
    date: new Date().toISOString(), speed: player.rate, transpose: +ui.octave.value,
    startTime: attemptStart, endTime: t, judged: s.judged, hit: s.hit, percent: s.percent,
    complete: attemptStart <= (song.notes[0]?.start ?? 0) + 0.01 && t >= (song.notes[song.notes.length - 1]?.end ?? 0),
    phraseHits: s.phraseHits, phraseTotals: s.phraseTotals,
  };
  saved = true; // a run is saved once; resetRun() starts the next
  try { await saveAttempt(a); } catch (e) { toast(`Could not save the score: ${e}`); return; }
  if (!ui.stats.hidden) void renderStats();
}

// ---- transport
async function togglePlay(): Promise<void> {
  if (!song) return;
  if (tuneMode) void setTuneMode(false);
  if (player.playing) { player.pause(); ui.play.textContent = "▶"; return; }
  if (player.position() >= player.duration - 0.5) seekTo(0);
  await player.play();
  ui.play.textContent = "⏸";
}

function seekTo(pos: number): void {
  void commitAttempt(); // takes its snapshot synchronously
  player.seek(pos);
  resetRun(Math.max(0, Math.min(pos, player.duration)));
}

ui.file.onchange = () => { if (ui.file.files?.[0]) void openFile(ui.file.files[0]); ui.file.value = ""; };
ui.track.onchange = () => void selectTrack(+ui.track.value);
ui.play.onclick = () => void togglePlay();
ui.restart.onclick = () => void seekTo(0);
ui.seek.oninput = () => void seekTo(+ui.seek.value);
ui.speed.oninput = () => {
  ui.speedVal.textContent = `${Math.round(+ui.speed.value * 100)}%`;
  void commitAttempt();
  player.setRate(+ui.speed.value);
  resetRun(player.position());
  savePrefs();
};
ui.speedVal.textContent = `${Math.round(+ui.speed.value * 100)}%`;
ui.octave.onchange = () => { player.guideTranspose = 12 * +ui.octave.value; player.setGuide(ui.guide.checked); savePrefs(); };
player.guideTranspose = 12 * +ui.octave.value;
ui.guide.onchange = () => { player.setGuide(ui.guide.checked); savePrefs(); };
player.guideOn = ui.guide.checked;
ui.bandVol.oninput = () => { player.backingGain.gain.value = +ui.bandVol.value; savePrefs(); };
player.backingGain.gain.value = +ui.bandVol.value;

const syncLabels = () => {
  ui.offsetVal.textContent = `${ui.offset.value} ms`;
  ui.tolVal.textContent = `±${ui.tol.value} ¢`;
  ui.aheadVal.textContent = `${ui.ahead.value} s`;
  view.secondsAhead = +ui.ahead.value;
  tracker.minRms = +ui.sens.value;
  if (judge) judge.settings = { ...judge.settings, toleranceCents: +ui.tol.value };
};
for (const el of [ui.offset, ui.tol, ui.ahead, ui.sens, ui.fold]) el.addEventListener("input", () => { syncLabels(); savePrefs(); });
syncLabels();

// Click the roll to jump: left of the now line goes back, right goes ahead.
ui.canvas.onclick = (e) => {
  if (!song || tuneMode) return;
  const r = ui.canvas.getBoundingClientRect();
  const nowX = r.width * 0.22;
  const dt = ((e.clientX - r.left - nowX) / (r.width - nowX)) * view.secondsAhead;
  void seekTo(Math.max(0, player.position() + dt));
};

window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "SELECT" || (e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLInputElement).type !== "range") return;
  if (e.code === "Space") { e.preventDefault(); void togglePlay(); }
  else if (e.code === "ArrowLeft") { e.preventDefault(); void seekTo(Math.max(0, player.position() - 5)); }
  else if (e.code === "ArrowRight") { e.preventDefault(); void seekTo(player.position() + 5); }
  else if (e.code === "Home") void seekTo(0);
  else if (e.key === "[" || e.key === "]") {
    ui.speed.value = String(Math.min(1, Math.max(0.5, +ui.speed.value + (e.key === "]" ? 0.05 : -0.05))));
    ui.speed.dispatchEvent(new Event("input"));
  }
});

// Drag and drop.
window.addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("drop"); });
window.addEventListener("dragleave", () => document.body.classList.remove("drop"));
window.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("drop");
  const f = e.dataTransfer?.files?.[0];
  if (f) void openFile(f);
});

// ---- microphone
async function fillMics(): Promise<void> {
  const want = ui.mic.value || (loadPrefs().mic as string) || "";
  const mics = await listInputs();
  ui.mic.innerHTML = "";
  for (const m of mics) {
    const o = document.createElement("option");
    o.value = m.deviceId;
    o.textContent = m.label || "Microphone";
    ui.mic.append(o);
  }
  if (mics.some((m) => m.deviceId === want)) ui.mic.value = want;
}

// ?sim: the guide tone stands in for the singer (for testing without a mic).
const SIM = new URLSearchParams(location.search).has("sim");

async function startMic(): Promise<void> {
  try {
    await player.ctx.resume();
    if (SIM) {
      tracker.startFromNode(player.guideGain);
      ui.guide.checked = true;
      player.setGuide(true);
      ui.micBtn.textContent = "🎤 Sim on";
      ui.micBtn.classList.add("on");
      return;
    }
    await tracker.start(ui.mic.value || undefined);
    await fillMics(); // labels appear once permission is granted
    ui.micBtn.textContent = "🎤 Mic on";
    ui.micBtn.classList.add("on");
    applyMicOffset();
    ui.micInfo.textContent = `Sample rate ${player.ctx.sampleRate} Hz · output latency ${(player.outputLatency * 1000).toFixed(0)} ms (already allowed for)`;
  } catch (e) {
    toast(`Microphone failed: ${e}`);
  }
}
ui.micBtn.onclick = async () => {
  if (tracker.running) { tracker.stop(); ui.micBtn.textContent = "🎤 Mic off"; ui.micBtn.classList.remove("on"); }
  else await startMic();
};
ui.mic.onchange = async () => { applyMicOffset(); savePrefs(); if (tracker.running) await startMic(); };
void fillMics().then(applyMicOffset);

// ---- stats panel
function showPanel(p: HTMLElement | null): void {
  for (const el of [ui.stats, ui.settings, ui.calib]) el.hidden = el !== p;
}
ui.statsBtn.onclick = () => { if (tuneMode) void setTuneMode(false); showPanel(ui.stats.hidden ? ui.stats : null); if (!ui.stats.hidden) void renderStats(); };
ui.setBtn.onclick = () => showPanel(ui.settings.hidden ? ui.settings : null);

// ---- tuner and latency calibration (no song plays here)
let tuneMode = false;
let tuneTrace: { t: number; midi: number | null }[] = [];
let range: [number, number] | null = null;
let held = { note: 0, since: 0 };
let calStatus = "";
let calAbort: AbortController | null = null;
const clock = () => performance.now() / 1000;

async function setTuneMode(on: boolean): Promise<void> {
  if (on === tuneMode) return;
  tuneMode = on;
  ui.tuneBtn.classList.toggle("on", on);
  if (on) {
    void commitAttempt();
    if (player.playing) { player.pause(); ui.play.textContent = "▶"; }
    showPanel(ui.calib);
    tuneTrace = [];
    applyMicOffset();
    if (!tracker.running) await startMic();
  } else {
    calAbort?.abort();
    if (!ui.calib.hidden) showPanel(null);
    if (song) resetRun(player.position());
  }
}
ui.tuneBtn.onclick = () => void setTuneMode(!tuneMode);
ui.rangeReset.onclick = () => { range = null; };

function tuneUpdate(): void {
  const r = tracker.running ? tracker.read() : null;
  const now = clock();
  const m = r?.midi ?? null;
  tuneTrace.push({ t: now, midi: m });
  while (tuneTrace.length && tuneTrace[0].t < now - 10) tuneTrace.shift();
  // A note counts toward the range once held on the same semitone for 0.3 s.
  if (m === null) { held.since = 0; return; }
  const note = Math.round(m);
  if (!held.since || note !== held.note) { held = { note, since: now }; return; }
  if (now - held.since >= 0.3) range = range ? [Math.min(range[0], note), Math.max(range[1], note)] : [note, note];
}

async function calibrate(mode: CalibMode): Promise<void> {
  if (calAbort) { calAbort.abort(); return; }
  if (!tracker.running) await startMic();
  const input = tracker.input;
  if (!input) { ui.calStatus.textContent = "Turn the microphone on first."; return; }
  calAbort = new AbortController();
  const btn = mode === "sing" ? ui.calSing : ui.calLoop;
  const label = btn.textContent;
  btn.textContent = "Stop";
  ui.calStatus.textContent = mode === "sing" ? "Listen to the count-in, then sing on every click." : "Measuring; stay quiet.";
  try {
    // In ?sim the clicks go straight into the stand-in "mic", so loopback reads about 0 ms.
    const out = SIM ? player.guideGain : player.ctx.destination;
    const res = await measure(player.ctx, input, out, mode, (k, of, counting) => {
      calStatus = counting ? `Count-in ${k}` : `Click ${k} / ${of}`;
    }, calAbort.signal);
    if (res.heard < Math.ceil(res.total * 0.6)) {
      ui.calStatus.textContent = `Only ${res.heard} of ${res.total} clicks were heard, so nothing was changed. ` +
        (mode === "sing" ? "Sing a little louder, short and sharp." : "Turn the volume up or bring the mic closer.");
      return;
    }
    const ms = Math.round(offsetFromRoundTrip(res.roundTripMs, player.outputLatency * 1000, tracker.windowSeconds * 1000));
    ui.offset.value = String(Math.max(0, Math.min(400, ms)));
    syncLabels();
    savePrefs();
    const mic = ui.mic.selectedOptions[0]?.textContent || "this mic";
    ui.calStatus.textContent = `Round trip ${res.roundTripMs.toFixed(0)} ms (±${res.spreadMs.toFixed(0)} ms, ${res.heard}/${res.total} clicks). ` +
      `Mic latency offset set to ${ui.offset.value} ms for ${mic}.` +
      (res.spreadMs > 15 ? " The clicks varied a lot; running it again may give a steadier figure." : "");
    applyMicOffset();
  } catch (e) {
    ui.calStatus.textContent = (e as Error).name === "AbortError" ? "Stopped; nothing was changed." : `Calibration failed: ${e}`;
  } finally {
    calAbort = null;
    calStatus = "";
    btn.textContent = label;
  }
}
ui.calSing.onclick = () => void calibrate("sing");
ui.calLoop.onclick = () => void calibrate("loopback");

async function renderStats(): Promise<void> {
  const el = ui.stats;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  let html = "<h2>Scores</h2>";
  if (song) {
    const rows = await attemptsFor(song.key);
    const full = rows.filter((r) => r.complete && r.speed >= 0.999);
    html += `<h3>${esc(song.title)} — ${rows.length} attempt${rows.length === 1 ? "" : "s"}</h3>`;
    html += full.length ? `<p>Best full song at 100%: <b>${Math.max(...full.map((r) => r.percent)).toFixed(0)}%</b></p>` : "";
    if (rows.length) {
      html += "<table><tr><th>When</th><th>Speed</th><th>Part</th><th class='num'>Score</th></tr>";
      for (const r of rows.slice(0, 15)) {
        html += `<tr><td>${new Date(r.date).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</td><td>${Math.round(r.speed * 100)}%</td>` +
          `<td>${r.complete ? "whole song" : `${fmt(r.startTime)}–${fmt(r.endTime)}`}</td><td class='num'>${r.percent.toFixed(0)}% <span style="color:var(--dim)">(${r.hit}/${r.judged})</span></td></tr>`;
      }
      html += "</table>";
      const rates = phraseRates(rows, song.phrases.length);
      const weak = rates.map((r, i) => ({ r, i })).filter((x) => x.r !== null).sort((a, b) => a.r! - b.r!).slice(0, 6);
      if (weak.length) {
        html += "<h3>Lines to practise (click to jump)</h3><table>";
        for (const w of weak) {
          const p = song.phrases[w.i];
          html += `<tr class="phrase" data-t="${p.start}"><td>${esc(phraseText(song.notes, p).text) || "(no lyrics)"}</td><td class='num'>${Math.round(w.r! * 100)}%</td></tr>`;
        }
        html += "</table>";
      }
    } else html += "<p class='hint'>No saved attempts yet. A run is saved when the song ends, or when you jump, restart or change speed after at least 8 notes.</p>";
  }
  const all = summarise(await allAttempts());
  if (all.length) {
    html += "<h3>All songs</h3><table><tr><th>Song</th><th class='num'>Tries</th><th class='num'>Best</th><th class='num'>Full@100%</th></tr>";
    for (const s of all) html += `<tr><td>${esc(s.title)}</td><td class='num'>${s.attempts}</td><td class='num'>${s.best.toFixed(0)}%</td><td class='num'>${s.bestFull === null ? "–" : s.bestFull.toFixed(0) + "%"}</td></tr>`;
    html += "</table>";
  }
  html += `<div class="row"><button class="btn" id="exp">Export scores</button><label class="btn">Import<input id="imp" type="file" accept=".json" hidden></label></div>`;
  el.innerHTML = html;
  el.querySelectorAll<HTMLElement>(".phrase").forEach((tr) => (tr.onclick = () => void seekTo(Math.max(0, +tr.dataset.t! - 2))));
  $("exp").onclick = async () => {
    const blob = new Blob([JSON.stringify(await allAttempts(), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vocals-trainer-scores-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  $<HTMLInputElement>("imp").onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try { toast(`Imported ${await importAttempts(JSON.parse(await f.text()))} attempts.`); void renderStats(); }
    catch (err) { toast(`Import failed: ${err}`); }
  };
}

// ---- main loop
function foldTo(m: number, ref: number): number {
  return m + 12 * Math.round((ref - m) / 12);
}

// Listening and judging run on a timer, drawing on animation frames: Chrome
// doesn't throttle timers in a tab that is playing audio, so a run keeps
// being scored while the window is in the background.
let ball: number | null = null, ballOn = false;

function update(): void {
  if (tuneMode) { tuneUpdate(); return; }
  const shift = 12 * +ui.octave.value;
  ball = null;
  ballOn = false;
  if (song && judge) {
    const t = player.position();
    const judgeT = t - (+ui.offset.value / 1000) * player.rate;
    const r = tracker.running ? tracker.read() : null;
    const dt = Math.max(0, judgeT - lastT);
    lastT = judgeT;
    let err: number | null = null;
    // Only judge while listening: with the mic off it's a play-through, not an attempt.
    if (player.playing && r) {
      if (dt < 0.25) err = judge.frame(judgeT, dt, r.midi);
      else judge.skip(judgeT);
    }

    if (r?.midi != null) {
      // Reference for folding: the active note, else the nearest one in time.
      const ref = nearestNote(song, judgeT);
      const target = ref ? ref.pitches[0] + shift : null;
      ball = ui.fold.checked && target !== null ? foldTo(r.midi, target) : r.midi;
      ballOn = err !== null && Math.abs(err) <= +ui.tol.value;
    }
    if (player.playing) {
      trail.push({ t: judgeT, midi: ball, on: ballOn });
      while (trail.length && trail[0].t < judgeT - 8) trail.shift();
    }
    // Streak over notes closed since the last frame.
    for (let i = lastClosed + 1; i < song.notes.length; i++) {
      const s = judge.state[i];
      if (s === "hit") { streak++; lastClosed = i; }
      else if (s === "miss") { streak = 0; lastClosed = i; }
      else if (s === "pending" && i < judge.startIndex) { lastClosed = i; }
      else break;
    }
    if (player.playing && t >= player.duration - 0.05) {
      player.pause();
      ui.play.textContent = "▶";
      judge.finish(t + 1);
      const s = judge.summary();
      void commitAttempt();
      toast(s.judged ? `Done: ${s.percent.toFixed(0)}% of notes hit (${s.hit}/${s.judged}).` : "Done.", 6000);
    }
  }
}

function draw(): void {
  if (tuneMode) {
    tunerView.draw({ now: clock(), trace: tuneTrace, midi: tuneTrace.at(-1)?.midi ?? null, tolerance: +ui.tol.value, range, status: calStatus });
    requestAnimationFrame(draw);
    return;
  }
  const t = song ? player.position() : 0;
  if (song) {
    ui.seek.value = String(t);
    ui.time.textContent = `${fmt(t)} / ${fmt(player.duration)}`;
  }
  const s = judge?.summary();
  view.draw(song, {
    t, states: judge?.state ?? [], trail, ball, ballOn, shift: 12 * +ui.octave.value,
    percent: s?.percent ?? 0, judged: s?.judged ?? 0, streak,
  });
  requestAnimationFrame(draw);
}

function nearestNote(s: Song, t: number) {
  let best = null, bd = Infinity;
  // Notes are sorted by start; a short scan around t is enough.
  let lo = 0, hi = s.notes.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (s.notes[m].end < t) lo = m + 1; else hi = m; }
  for (let i = Math.max(0, lo - 1); i < Math.min(s.notes.length, lo + 2); i++) {
    const n = s.notes[i];
    const d = t < n.start ? n.start - t : t > n.end ? t - n.end : 0;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

window.addEventListener("beforeunload", () => void commitAttempt());
setInterval(update, 16);
requestAnimationFrame(draw);
