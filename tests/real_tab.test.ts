// Runs only when VT_TAB points at a real .gp file (tabs never go in this repo):
//   VT_TAB="path/to/song.gp" npx vitest run tests/real_tab.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadScore, vocalCandidates, buildSong, phraseText } from "../src/song";

const path = process.env.VT_TAB;

describe.skipIf(!path)("real tab", () => {
  it("finds a vocal track with timed, lyric-bearing notes", () => {
    const score = loadScore(new Uint8Array(readFileSync(path!)));
    const cands = vocalCandidates(score);
    expect(cands[0].lyricBeats).toBeGreaterThan(0);
    const song = buildSong(score, cands[0].index);
    expect(song.notes.length).toBeGreaterThan(20);
    for (let i = 1; i < song.notes.length; i++) {
      expect(song.notes[i].start).toBeGreaterThanOrEqual(song.notes[i - 1].start - 1e-6);
      expect(song.notes[i].end).toBeGreaterThan(song.notes[i].start);
    }
    console.log(cands.slice(0, 3), song.notes.length, "notes,", song.phrases.length, "phrases,",
      `first at ${song.notes[0].start.toFixed(2)} s`, "range", song.pitchMin, song.pitchMax);
    for (const p of song.phrases.slice(0, 6)) console.log(p.start.toFixed(2), phraseText(song.notes, p).text);
  });
});
