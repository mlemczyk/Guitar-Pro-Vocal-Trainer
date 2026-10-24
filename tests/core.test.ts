import { describe, expect, it } from "vitest";
import { tickToSeconds } from "../src/timing";
import { foldedCents, bestCents, Judge } from "../src/scoring";
import { splitPhrases, phraseText, type Song, type VocalNote } from "../src/song";

function note(start: number, end: number, pitch: number, syllable = "", joinNext = false): VocalNote {
  return { index: 0, start, end, pitches: [pitch], syllable, joinNext, phrase: 0 };
}
function song(notes: VocalNote[]): Song {
  notes.forEach((n, i) => (n.index = i));
  return { title: "t", artist: "a", key: "a - t", trackIndex: 0, trackName: "v", notes, phrases: splitPhrases(notes),
    backingAudio: null, pitchMin: 60, pitchMax: 72 };
}

describe("timing", () => {
  it("maps ticks through sync points", () => {
    const pts = [
      { synthTick: 0, syncTime: 500, syncBpm: 120 },
      { synthTick: 3840, syncTime: 2600, syncBpm: 60 },
    ];
    expect(tickToSeconds(0, pts)).toBeCloseTo(0.5);
    expect(tickToSeconds(960, pts)).toBeCloseTo(1.0);   // one beat at 120
    expect(tickToSeconds(3840, pts)).toBeCloseTo(2.6);  // the second point wins
    expect(tickToSeconds(4800, pts)).toBeCloseTo(3.6);  // one beat at 60
  });
});

describe("pitch comparison", () => {
  it("folds octaves", () => {
    expect(foldedCents(72, 60)).toBeCloseTo(0);
    expect(foldedCents(48.3, 60)).toBeCloseTo(30);
    expect(foldedCents(59.6, 60)).toBeCloseTo(-40);
    expect(Math.abs(foldedCents(66, 60))).toBeCloseTo(600);
  });
  it("matches any harmony note", () => {
    expect(bestCents(64.1, [67, 64])).toBeCloseTo(10);
  });
});

describe("judge", () => {
  const s = song([note(0, 1, 60, "Hel", true), note(1, 2, 62, "lo"), note(2, 3, 64, "there")]);
  function run(sung: (t: number) => number | null) {
    const j = new Judge(s);
    j.reset(0);
    for (let t = 0; t < 3.2; t += 0.01) j.frame(t, 0.01, sung(t));
    j.finish(4);
    return j;
  }
  it("hits notes sung in tune, including an octave down", () => {
    const j = run((t) => (t < 1 ? 48.2 : t < 2 ? 62 : 64.3));
    expect(j.state).toEqual(["hit", "hit", "hit"]);
    expect(j.summary().percent).toBeCloseTo(100);
  });
  it("misses silence and wrong notes", () => {
    const j = run((t) => (t < 1 ? null : t < 2 ? 63 : 64));
    expect(j.state).toEqual(["miss", "miss", "hit"]);
  });
  it("does not judge notes before the start point", () => {
    const j = new Judge(s);
    j.reset(1.5);
    for (let t = 1.5; t < 3.2; t += 0.01) j.frame(t, 0.01, 64);
    j.finish(4);
    expect(j.state[0]).toBe("pending");
    expect(j.summary().judged).toBe(2);
  });
});

describe("phrases", () => {
  it("splits at rests and joins hyphenated syllables", () => {
    const ns = [note(0, 0.5, 60, "Hel", true), note(0.5, 1, 60, "lo"), note(1, 1.5, 60, "world"),
      note(3.5, 4, 60, "a", true), note(4, 4.5, 60, "gain")];
    const s2 = song(ns);
    expect(s2.phrases.length).toBe(2);
    expect(phraseText(s2.notes, s2.phrases[0]).text).toBe("Hello world");
    expect(phraseText(s2.notes, s2.phrases[1]).text).toBe("again");
  });
});
