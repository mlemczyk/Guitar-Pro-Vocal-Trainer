// Latency calibration: play clicks, record the mic sample by sample on the
// same AudioContext clock, and find when each click (or the singer's "ta" on
// it) arrives. The delay from click to arrival is the round trip:
//   output latency (as actually heard) + input latency (+ the singer's own
//   timing, in "sing" mode, which is what matters for scoring anyway).
// The analysis is a pure function so it can be tested without audio.

export type CalibMode = "loopback" | "sing";

export interface CalibResult {
  roundTripMs: number;   // median click -> arrival
  spreadMs: number;      // median absolute deviation
  heard: number;         // clicks with a detected arrival
  total: number;
  deltasMs: (number | null)[];
}

export const PLAN: Record<CalibMode, { period: number; countIn: number; clicks: number; early: number; late: number }> = {
  // Loopback: the mic hears the clicks themselves, so nothing arrives early.
  loopback: { period: 0.6, countIn: 1, clicks: 10, early: 0, late: 0.35 },
  // Sing: a short "ta" on each click; a singer can land a little early.
  sing: { period: 1.0, countIn: 4, clicks: 12, early: 0.2, late: 0.5 },
};

/** Arrival delay (s) of each click in a recording, or null where none was found. */
export function findArrivals(rec: Float32Array, recStart: number, sr: number, clicks: number[], mode: CalibMode): (number | null)[] {
  const p = PLAN[mode];
  const idx = (t: number) => Math.max(0, Math.min(rec.length, Math.round((t - recStart) * sr)));
  return clicks.map((c) => {
    // Noise from a quiet stretch before the search window.
    const n0 = idx(c - p.early - 0.25), n1 = idx(c - p.early - 0.02);
    const noise = percentileAbs(rec, n0, n1, 0.95);
    const a = idx(c - p.early), b = idx(c + p.late);
    let peak = 0;
    for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(rec[i]));
    if (b <= a || peak < 0.003 || peak < noise * 6) return null;
    // Onset: the first sample above a fraction of the event's own peak.
    const thr = Math.max(noise * 3, peak * 0.2);
    for (let i = a; i < b; i++) if (Math.abs(rec[i]) > thr) return (recStart + i / sr) - c;
    return null;
  });
}

export function summariseArrivals(deltas: (number | null)[]): CalibResult {
  const got = deltas.filter((d): d is number => d !== null).map((d) => d * 1000);
  const med = median(got);
  return {
    roundTripMs: med, spreadMs: median(got.map((d) => Math.abs(d - med))),
    heard: got.length, total: deltas.length, deltasMs: deltas.map((d) => (d === null ? null : d * 1000)),
  };
}

/**
 * The app's mic offset from a round trip. The song clock already removes the
 * output latency the browser reports, and a pitch reading describes audio
 * about half an analysis window old.
 */
export function offsetFromRoundTrip(roundTripMs: number, reportedOutputMs: number, windowMs: number): number {
  return roundTripMs - reportedOutputMs + windowMs / 2;
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentileAbs(x: Float32Array, a: number, b: number, q: number): number {
  if (b <= a) return 0;
  const v = Array.from(x.subarray(a, b), Math.abs).sort((p, r) => p - r);
  return v[Math.min(v.length - 1, Math.floor(q * v.length))];
}

// ---- live measurement

const RECORDER = `registerProcessor("vt-recorder", class extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage({ f: currentFrame, d: ch.slice(0) }); return true; }
});`;
const loaded = new WeakMap<BaseAudioContext, Promise<void>>();

function loadRecorder(ctx: AudioContext): Promise<void> {
  let p = loaded.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([RECORDER], { type: "application/javascript" }));
    p = ctx.audioWorklet.addModule(url);
    loaded.set(ctx, p);
  }
  return p;
}

function clickBuffer(ctx: AudioContext, hz: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.round(sr * 0.03);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.sin((2 * Math.PI * hz * i) / sr) * Math.exp(-i / (sr * 0.006));
  return buf;
}

/**
 * Play the click pattern into `out` and record `input` meanwhile.
 * Resolves with the analysis once the last click's window has passed.
 */
export async function measure(ctx: AudioContext, input: AudioNode, out: AudioNode, mode: CalibMode,
  onClick: (k: number, of: number, counting: boolean) => void, signal?: AbortSignal): Promise<CalibResult> {
  await ctx.resume();
  await loadRecorder(ctx);
  const p = PLAN[mode];
  const sr = ctx.sampleRate;
  const start = ctx.currentTime + 0.4;
  const all = Array.from({ length: p.countIn + p.clicks }, (_, k) => start + 0.6 + k * p.period);
  const end = all[all.length - 1] + p.late + 0.1;
  const rec = new Float32Array(Math.ceil((end - start + 0.5) * sr));
  const recStart = start - 0.4;

  const node = new AudioWorkletNode(ctx, "vt-recorder", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.port.onmessage = (e) => {
    const { f, d } = e.data as { f: number; d: Float32Array };
    const i = f - Math.round(recStart * sr);
    if (i >= 0 && i + d.length <= rec.length) rec.set(d, i);
  };
  input.connect(node);
  node.connect(sink).connect(ctx.destination);

  const hiClick = clickBuffer(ctx, 2000), loClick = clickBuffer(ctx, 1300);
  const level = ctx.createGain();
  level.gain.value = mode === "loopback" ? 0.9 : 0.5;
  level.connect(out);
  const sources = all.map((t, k) => {
    const s = ctx.createBufferSource();
    s.buffer = k < p.countIn || (k - p.countIn) % 4 === 0 ? hiClick : loClick;
    s.connect(level);
    s.start(t);
    return s;
  });

  try {
    await new Promise<void>((resolve, reject) => {
      let shown = -1;
      const tick = setInterval(() => {
        if (signal?.aborted) { clearInterval(tick); reject(new DOMException("Stopped", "AbortError")); return; }
        const k = all.findIndex((t) => t > ctx.currentTime) - 1;
        const cur = k < 0 ? all.length - 1 : k;
        if (cur !== shown && ctx.currentTime >= all[0]) {
          shown = cur;
          onClick(cur < p.countIn ? cur + 1 : cur - p.countIn + 1, cur < p.countIn ? p.countIn : p.clicks, cur < p.countIn);
        }
        if (ctx.currentTime > end) { clearInterval(tick); resolve(); }
      }, 20);
    });
  } finally {
    sources.forEach((s) => { try { s.stop(); } catch { /* ended */ } });
    level.disconnect();
    input.disconnect(node);
    node.disconnect();
    node.port.onmessage = null;
  }
  return summariseArrivals(findArrivals(rec, recStart, sr, all.slice(p.countIn), mode));
}
