// Backing-track playback with pitch-preserving slow-down (Signalsmith
// Stretch), plus an optional sine "guide tone" playing the vocal melody.
//
// Clock: the song position is computed from the AudioContext clock, not
// polled, so the view is smooth. position() is what the listener hears now
// (output latency removed).
import SignalsmithStretch from "signalsmith-stretch";
import type { Song } from "./song";

type StretchNode = AudioNode & {
  addBuffers(channels: Float32Array[]): Promise<number>;
  dropBuffers(): Promise<unknown>;
  schedule(o: Record<string, number | boolean>): void;
  latency(): number;
};

const LEAD = 0.12; // seconds scheduled ahead so the stretcher can settle

export class Player {
  readonly ctx: AudioContext;
  private stretch: StretchNode | null = null;
  readonly backingGain: GainNode;
  readonly guideGain: GainNode;
  duration = 0;
  rate = 1;
  playing = false;
  private anchorCtx = 0;   // ctx time at which anchorPos is heard
  private anchorPos = 0;
  private guideVoices: OscillatorNode[] = [];
  private song: Song | null = null;
  guideOn = false;
  guideTranspose = 0;      // semitones

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.backingGain = this.ctx.createGain();
    this.backingGain.connect(this.ctx.destination);
    this.guideGain = this.ctx.createGain();
    this.guideGain.gain.value = 0.18;
    this.guideGain.connect(this.ctx.destination);
  }

  get outputLatency(): number {
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
  }

  async load(song: Song): Promise<void> {
    this.stop();
    this.song = song;
    if (!this.stretch) {
      this.stretch = (await SignalsmithStretch(this.ctx)) as StretchNode;
      this.stretch.connect(this.backingGain);
    } else {
      await this.stretch.dropBuffers();
    }
    this.duration = song.notes.length ? song.notes[song.notes.length - 1].end + 2 : 0;
    if (song.backingAudio) {
      const buf = await this.ctx.decodeAudioData(song.backingAudio.slice().buffer);
      const chans: Float32Array[] = [];
      for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chans.push(buf.getChannelData(c));
      if (chans.length === 1) chans.push(chans[0]);
      await this.stretch.addBuffers(chans);
      this.duration = Math.max(this.duration, buf.duration);
    }
    this.anchorPos = 0;
  }

  /** Song seconds the listener hears right now. */
  position(): number {
    if (!this.playing) return this.anchorPos;
    const heardAt = this.ctx.currentTime - this.outputLatency;
    return this.anchorPos + Math.max(0, heardAt - this.anchorCtx) * this.rate;
  }

  async play(): Promise<void> {
    if (this.playing || !this.stretch) return;
    await this.ctx.resume();
    const when = this.ctx.currentTime + LEAD;
    this.stretch.schedule({ active: true, input: this.anchorPos, rate: this.rate, output: when });
    this.anchorCtx = when;
    this.playing = true;
    this.scheduleGuide(when);
  }

  pause(): void {
    if (!this.playing) return;
    const pos = this.position();
    this.stretch?.schedule({ active: false, output: this.ctx.currentTime });
    this.stopGuide();
    this.playing = false;
    this.anchorPos = pos;
  }

  stop(): void {
    this.pause();
    this.anchorPos = 0;
  }

  seek(pos: number): void {
    const was = this.playing;
    this.pause();
    this.anchorPos = Math.max(0, Math.min(pos, this.duration));
    if (was) void this.play();
  }

  setRate(rate: number): void {
    const was = this.playing;
    this.pause();
    this.rate = rate;
    if (was) void this.play();
  }

  setGuide(on: boolean): void {
    this.guideOn = on;
    if (this.playing) { this.stopGuide(); this.scheduleGuide(this.ctx.currentTime + 0.05, true); }
  }

  /** Schedule the melody as short sine notes from the current position. */
  private scheduleGuide(when: number, fromNow = false): void {
    if (!this.guideOn || !this.song) return;
    const pos0 = fromNow ? this.position() : this.anchorPos;
    const toCtx = (t: number) => when + (t - pos0) / this.rate;
    for (const n of this.song.notes) {
      if (n.end <= pos0) continue;
      const a = Math.max(toCtx(n.start), when);
      const b = toCtx(n.end);
      if (b - a < 0.02) continue;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = 440 * 2 ** ((n.pitches[0] + this.guideTranspose - 69) / 12);
      g.gain.setValueAtTime(0, a);
      g.gain.linearRampToValueAtTime(1, a + 0.015);
      g.gain.setValueAtTime(1, Math.max(a + 0.016, b - 0.03));
      g.gain.linearRampToValueAtTime(0, b);
      osc.connect(g).connect(this.guideGain);
      osc.start(a);
      osc.stop(b + 0.01);
      this.guideVoices.push(osc);
    }
  }

  private stopGuide(): void {
    for (const o of this.guideVoices) { try { o.stop(); } catch { /* not started */ } o.disconnect(); }
    this.guideVoices = [];
  }
}
