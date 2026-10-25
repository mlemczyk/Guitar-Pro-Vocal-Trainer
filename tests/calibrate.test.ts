import { describe, expect, it } from "vitest";
import { findArrivals, summariseArrivals, offsetFromRoundTrip, PLAN } from "../src/calibrate";

const SR = 48000;

/** A recording with low noise and a burst `delay` s after each click (null = silent). */
function recording(clicks: number[], delays: (number | null)[], recStart: number, len: number, ramp = 0) {
  const rec = new Float32Array(Math.round(len * SR));
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i < rec.length; i++) rec[i] = rnd() * 0.002;
  clicks.forEach((c, k) => {
    const d = delays[k];
    if (d === null) return;
    const i0 = Math.round((c + d - recStart) * SR);
    for (let i = 0; i < SR * 0.08; i++) {
      const env = ramp ? Math.min(1, i / (ramp * SR)) : 1;
      rec[i0 + i] += 0.3 * env * Math.exp(-i / (SR * 0.02)) * Math.sin((2 * Math.PI * 300 * i) / SR + 0.3);
    }
  });
  return rec;
}

describe("latency calibration", () => {
  it("finds loopback arrivals to the millisecond", () => {
    const p = PLAN.loopback;
    const clicks = Array.from({ length: p.clicks }, (_, k) => 1 + k * p.period);
    const delays = clicks.map((_, k) => 0.085 + (k % 3) * 0.001);
    const rec = recording(clicks, delays, 0.5, 9);
    const res = summariseArrivals(findArrivals(rec, 0.5, SR, clicks, "loopback"));
    expect(res.heard).toBe(p.clicks);
    expect(res.roundTripMs).toBeGreaterThan(84);
    expect(res.roundTripMs).toBeLessThan(88);
    expect(res.spreadMs).toBeLessThan(2);
  });

  it("accepts early sung onsets and skips missed clicks", () => {
    const p = PLAN.sing;
    const clicks = Array.from({ length: p.clicks }, (_, k) => 2 + k * p.period);
    const delays = clicks.map((_, k) => (k === 4 || k === 9 ? null : k % 2 ? -0.03 : 0.17));
    const rec = recording(clicks, delays, 1, 16, 0.01);
    const d = findArrivals(rec, 1, SR, clicks, "sing");
    expect(d[4]).toBeNull();
    expect(d[9]).toBeNull();
    const res = summariseArrivals(d);
    expect(res.heard).toBe(p.clicks - 2);
    expect(Math.min(...res.deltasMs.filter((x): x is number => x !== null))).toBeLessThan(-25);
  });

  it("turns a round trip into the app's offset", () => {
    // 90 ms round trip, browser reports 30 ms output latency, 2048-sample window at 48 kHz.
    expect(offsetFromRoundTrip(90, 30, (2048 / 48000) * 1000)).toBeCloseTo(81.3, 1);
  });
});
