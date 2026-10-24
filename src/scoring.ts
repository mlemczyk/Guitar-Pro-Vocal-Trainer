// Hit/miss judgement. A note is judged on the frames sung while it is
// active; octaves count as hits (pitch is compared as a pitch class).
import type { Song } from "./song";

export interface ScoreSettings {
  toleranceCents: number;   // |error| within this is on pitch
  hitFraction: number;      // share of a note's frames that must be on pitch
}

export const DEFAULT_SCORING: ScoreSettings = { toleranceCents: 50, hitFraction: 0.4 };

/** Signed cents from target to sung, folded to the nearest octave (-600..600). */
export function foldedCents(sungMidi: number, targetMidi: number): number {
  const c = (sungMidi - targetMidi) * 100;
  return ((((c + 600) % 1200) + 1200) % 1200) - 600;
}

/** Best match against any note of a (harmony) chord. */
export function bestCents(sungMidi: number, targets: number[]): number {
  let best = Infinity;
  for (const t of targets) {
    const c = foldedCents(sungMidi, t);
    if (Math.abs(c) < Math.abs(best)) best = c;
  }
  return best;
}

export type NoteState = "pending" | "active" | "hit" | "miss";

export class Judge {
  frames: Float64Array;
  onPitch: Float64Array;
  state: NoteState[];
  private cursor = 0;

  constructor(private song: Song, public settings: ScoreSettings = DEFAULT_SCORING) {
    const n = song.notes.length;
    this.frames = new Float64Array(n);
    this.onPitch = new Float64Array(n);
    this.state = new Array(n).fill("pending");
  }

  /** First note judged in this run; earlier notes stay "pending" (unjudged). */
  startIndex = 0;

  reset(fromTime = 0): void {
    this.frames.fill(0);
    this.onPitch.fill(0);
    this.state.fill("pending");
    this.cursor = this.song.notes.findIndex((n) => n.end > fromTime);
    if (this.cursor < 0) this.cursor = this.song.notes.length;
    this.startIndex = this.cursor;
  }

  /**
   * One analysis frame at song time t (seconds), weighted by dt. sungMidi is
   * null when nothing voiced was detected. Returns the cents error against
   * the active note, if any.
   */
  frame(t: number, dt: number, sungMidi: number | null): number | null {
    const notes = this.song.notes;
    // Close notes that have ended.
    while (this.cursor < notes.length && notes[this.cursor].end <= t) {
      this.close(this.cursor++);
    }
    let err: number | null = null;
    for (let i = this.cursor; i < notes.length && notes[i].start <= t; i++) {
      const n = notes[i];
      if (n.end <= t) continue;
      this.state[i] = "active";
      this.frames[i] += dt;
      if (sungMidi !== null) {
        const c = bestCents(sungMidi, n.pitches);
        if (Math.abs(c) <= this.settings.toleranceCents) this.onPitch[i] += dt;
        if (err === null || Math.abs(c) < Math.abs(err)) err = c;
      }
    }
    return err;
  }

  private close(i: number): void {
    const f = this.frames[i];
    if (f <= 0) { this.state[i] = "miss"; return; }
    const short = this.song.notes[i].end - this.song.notes[i].start < 0.15;
    const ok = short ? this.onPitch[i] > 0 : this.onPitch[i] / f >= this.settings.hitFraction;
    this.state[i] = ok ? "hit" : "miss";
  }

  /**
   * Nobody was listening up to t (the page stalled, e.g. a hidden tab):
   * notes that ended unobserved stay unjudged rather than counting as misses.
   */
  skip(t: number): void {
    const notes = this.song.notes;
    while (this.cursor < notes.length && notes[this.cursor].end <= t) {
      if (this.frames[this.cursor] > 0) this.close(this.cursor);
      else this.state[this.cursor] = "pending";
      this.cursor++;
    }
  }

  /** Close everything up to t (for when playback stops). */
  finish(t: number): void {
    const notes = this.song.notes;
    while (this.cursor < notes.length && notes[this.cursor].start < t) this.close(this.cursor++);
  }

  summary(): { judged: number; hit: number; percent: number; phraseHits: number[]; phraseTotals: number[] } {
    let judged = 0, hit = 0;
    const phraseHits = new Array(this.song.phrases.length).fill(0);
    const phraseTotals = new Array(this.song.phrases.length).fill(0);
    this.state.forEach((s, i) => {
      if (s !== "hit" && s !== "miss") return;
      judged++;
      const p = this.song.notes[i].phrase;
      phraseTotals[p]++;
      if (s === "hit") { hit++; phraseHits[p]++; }
    });
    return { judged, hit, percent: judged ? (100 * hit) / judged : 0, phraseHits, phraseTotals };
  }
}
