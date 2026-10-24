// The Yousician-style screen: dark pitch lanes, note pills with syllables
// scrolling right-to-left past a "now" line, the sung-pitch ball with its
// trail, and the lyric lines underneath.
import type { Song } from "./song";
import { phraseText } from "./song";
import type { NoteState } from "./scoring";

export interface TrailPoint { t: number; midi: number | null; on: boolean }

export interface Frame {
  t: number;                 // song seconds at the now line
  states: NoteState[];
  trail: TrailPoint[];
  ball: number | null;       // display MIDI of the sung pitch
  ballOn: boolean;
  shift: number;             // semitones the targets are drawn shifted by
  percent: number;
  judged: number;
  streak: number;
}

const C = {
  bg: "#101218", laneA: "#151821", laneB: "#12141c", cLine: "#2a2f3c", label: "#5c6475",
  now: "rgba(255,255,255,0.18)", pending: "#3b4150", active: "#7b8597", hit: "#37c46b", miss: "#a2414f",
  text: "#e9ecf2", dim: "#7d8596", trail: "rgba(235,238,245,0.75)", ball: "#ffffff",
};
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export class View {
  private ctx: CanvasRenderingContext2D;
  secondsAhead = 5;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  private fit(): [number, number] {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [w, h];
  }

  draw(song: Song | null, f: Frame): void {
    const [W, H] = this.fit();
    const g = this.ctx;
    g.fillStyle = C.bg;
    g.fillRect(0, 0, W, H);
    if (!song) {
      g.fillStyle = C.dim;
      g.font = "20px system-ui, sans-serif";
      g.textAlign = "center";
      g.fillText("Open a Guitar Pro file to start", W / 2, H / 2);
      return;
    }

    const hudH = 44, lyricsH = Math.max(110, H * 0.22);
    const rollH = H - hudH - lyricsH;
    // Lanes are capped in height; spare space widens the range instead, centred on the song.
    const span = song.pitchMax - song.pitchMin + 7;
    const lane = Math.min(rollH / span, 30);
    const lanes = rollH / lane;
    const mid = (song.pitchMin + song.pitchMax) / 2 + f.shift;
    const lo = mid - lanes / 2 + 0.5, hi = mid + lanes / 2 - 0.5;
    const top = hudH;
    const y = (m: number) => top + (hi - m + 0.5) * lane;
    const nowX = W * 0.22;
    const pps = (W - nowX) / this.secondsAhead;
    const x = (t: number) => nowX + (t - f.t) * pps;
    const tMin = f.t - nowX / pps, tMax = f.t + this.secondsAhead;

    // Lanes.
    for (let m = Math.ceil(lo); m <= hi; m++) {
      const pc = ((m % 12) + 12) % 12;
      g.fillStyle = [1, 3, 6, 8, 10].includes(pc) ? C.laneB : C.laneA;
      g.fillRect(0, y(m) - lane / 2, W, lane);
      if (pc === 0) {
        g.fillStyle = C.cLine;
        g.fillRect(0, y(m) + lane / 2 - 1, W, 1);
        g.fillStyle = C.label;
        g.font = "11px system-ui, sans-serif";
        g.textAlign = "left";
        g.fillText(`C${Math.floor(m / 12) - 1}`, 6, y(m) + 4);
      }
    }

    // Notes.
    const ph = Math.max(12, Math.min(lane * 0.85, 34));
    g.textBaseline = "middle";
    for (const n of song.notes) {
      if (n.end < tMin || n.start > tMax) continue;
      const st = f.states[n.index];
      const x0 = x(n.start), x1 = Math.max(x(n.end) - 2, x0 + ph * 0.6);
      n.pitches.forEach((p, k) => {
        const yy = y(p + f.shift);
        g.fillStyle = st === "hit" ? C.hit : st === "miss" ? C.miss : st === "active" ? C.active : C.pending;
        g.globalAlpha = k === 0 ? 1 : 0.45;
        roundRect(g, x0, yy - ph / 2, x1 - x0, ph, ph / 2);
        g.fill();
        if (st === "active" && k === 0) { g.strokeStyle = C.text; g.lineWidth = 1.5; g.stroke(); }
      });
      g.globalAlpha = 1;
      if (n.syllable) {
        g.font = `${Math.round(Math.min(ph * 0.62, 17))}px system-ui, sans-serif`;
        g.fillStyle = C.text;
        g.textAlign = "left";
        const tw = g.measureText(n.syllable).width;
        const yy = y(n.pitches[0] + f.shift);
        if (tw + ph * 0.5 <= x1 - x0) g.fillText(n.syllable, x0 + ph * 0.3, yy + 1);
        else g.fillText(n.syllable, x0, yy - ph / 2 - 8);
      }
    }

    // Now line.
    g.fillStyle = C.now;
    g.fillRect(nowX - 1, top, 2, rollH);

    // Trail.
    g.lineWidth = 3;
    g.lineCap = "round";
    let prev: TrailPoint | null = null;
    for (const p of f.trail) {
      if (p.t < tMin) { prev = p; continue; }
      if (prev && prev.midi !== null && p.midi !== null && Math.abs(p.midi - prev.midi) < 2) {
        g.strokeStyle = p.on ? C.hit : C.trail;
        g.beginPath();
        g.moveTo(x(prev.t), y(prev.midi));
        g.lineTo(x(p.t), y(p.midi));
        g.stroke();
      }
      prev = p;
    }

    // Ball.
    if (f.ball !== null) {
      const by = Math.max(top + 8, Math.min(top + rollH - 8, y(f.ball)));
      g.shadowColor = f.ballOn ? C.hit : "rgba(255,255,255,0.8)";
      g.shadowBlur = 18;
      g.fillStyle = f.ballOn ? "#b8ffd2" : C.ball;
      g.beginPath();
      g.arc(nowX, by, 9, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
    }

    // HUD.
    g.fillStyle = C.text;
    g.font = "600 18px system-ui, sans-serif";
    g.textAlign = "left";
    g.fillText(`${song.artist ? song.artist + " – " : ""}${song.title}`, 14, hudH / 2);
    g.textAlign = "right";
    g.fillText(f.judged ? `${f.percent.toFixed(0)}%  ·  streak ${f.streak}` : "", W - 14, hudH / 2);

    this.drawLyrics(song, f, top + rollH, lyricsH, W);
  }

  private drawLyrics(song: Song, f: Frame, top: number, h: number, W: number): void {
    const g = this.ctx;
    const ps = song.phrases;
    if (!ps.length) return;
    // Current phrase: the one being sung, else the next one coming up.
    let i = ps.findIndex((p) => p.end > f.t - 0.15);
    if (i < 0) return;
    const cur = ps[i], next = ps[i + 1];
    g.textBaseline = "middle";
    g.textAlign = "left";

    const big = Math.min(38, h * 0.32);
    g.font = `600 ${big}px system-ui, sans-serif`;
    const { text, spans } = phraseText(song.notes, cur);
    let x0 = (W - g.measureText(text).width) / 2;
    const yy = top + h * 0.38;
    // Draw piece by piece so each syllable can carry its note's state.
    let cursor = 0;
    spans.forEach(([a, b], k) => {
      const ni = cur.first + k;
      const st = f.states[ni];
      if (a > cursor) { g.fillStyle = C.dim; const s = text.slice(cursor, a); g.fillText(s, x0, yy); x0 += g.measureText(s).width; }
      const s = text.slice(a, b);
      g.fillStyle = st === "hit" ? C.hit : st === "miss" ? "#d06a77" : st === "active" ? "#ffffff" : C.dim;
      g.fillText(s, x0, yy);
      x0 += g.measureText(s).width;
      cursor = b;
    });
    if (next) {
      g.font = `${Math.round(big * 0.6)}px system-ui, sans-serif`;
      g.fillStyle = "#565d6c";
      g.textAlign = "center";
      g.fillText(phraseText(song.notes, next).text, W / 2, top + h * 0.75);
    }
  }
}

export function noteName(m: number): string {
  const r = Math.round(m);
  return `${NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
