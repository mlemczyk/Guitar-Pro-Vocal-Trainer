// Live microphone pitch (McLeod pitch method, via pitchy). Read once per
// animation frame; the analysis window is the most recent 2048 samples.
import { PitchDetector } from "pitchy";

export interface PitchReading { midi: number | null; clarity: number; rms: number }

export class PitchTracker {
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private buf = new Float32Array(2048);
  private detector = PitchDetector.forFloat32Array(2048);
  minClarity = 0.88;
  minRms = 0.006;
  inputGain = 1;

  constructor(private ctx: AudioContext) {}

  get running(): boolean { return this.analyser !== null; }

  /** The node being listened to (the mic, or the ?sim stand-in), for calibration. */
  get input(): AudioNode | null { return this.source ?? this.simNode; }

  /** Window length in seconds: the reading describes audio about half this old. */
  get windowSeconds(): number { return this.buf.length / this.ctx.sampleRate; }

  async start(deviceId?: string): Promise<void> {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: 1,
      },
    });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.source.connect(this.analyser);
  }

  /** Test mode: analyse an audio node (e.g. the guide tone) instead of a mic. */
  startFromNode(node: AudioNode): void {
    this.stop();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    node.connect(this.analyser);
    this.simNode = node;
  }
  private simNode: AudioNode | null = null;

  stop(): void {
    if (this.simNode && this.analyser) this.simNode.disconnect(this.analyser);
    this.simNode = null;
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    this.analyser = null;
  }

  read(): PitchReading {
    if (!this.analyser) return { midi: null, clarity: 0, rms: 0 };
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(s / this.buf.length) * this.inputGain;
    if (rms < this.minRms) return { midi: null, clarity: 0, rms };
    const [hz, clarity] = this.detector.findPitch(this.buf, this.ctx.sampleRate);
    // Singing range, roughly E2..C6.
    if (clarity < this.minClarity || hz < 80 || hz > 1100) return { midi: null, clarity, rms };
    return { midi: 69 + 12 * Math.log2(hz / 440), clarity, rms };
  }
}

export async function listInputs(): Promise<MediaDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "audioinput");
}
