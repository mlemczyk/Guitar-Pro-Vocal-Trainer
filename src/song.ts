// Guitar Pro file -> what the trainer needs: timed vocal notes with lyrics,
// and the embedded backing track. alphaTab does the parsing; this module
// only flattens it onto the backing track's time axis.
import * as at from "@coderline/alphatab";
import { SyncPoint, tickToSeconds } from "./timing";

export interface VocalNote {
  index: number;
  start: number;          // seconds on the backing-track time axis
  end: number;
  pitches: number[];      // MIDI numbers, highest first (harmonies included)
  syllable: string;       // lyric with its trailing hyphen removed
  joinNext: boolean;      // the syllable continues into the next one (no space)
  phrase: number;         // index into Song.phrases
}

export interface Phrase { first: number; last: number; start: number; end: number }

export interface TrackChoice { index: number; name: string; notes: number; lyricBeats: number }

export interface Song {
  title: string;
  artist: string;
  key: string;            // identity for saved stats
  trackIndex: number;
  trackName: string;
  notes: VocalNote[];
  phrases: Phrase[];
  backingAudio: Uint8Array | null;
  pitchMin: number;
  pitchMax: number;
}

const VOCAL_NAME = /vocal|voice|vox|lyric|sing|chant/i;

export function loadScore(bytes: Uint8Array): at.model.Score {
  return at.importer.ScoreLoader.loadScoreFromBytes(bytes, new at.Settings());
}

/** Tracks worth offering, most vocal-looking first. */
export function vocalCandidates(score: at.model.Score): TrackChoice[] {
  const out: TrackChoice[] = [];
  for (const t of score.tracks) {
    let notes = 0, lyricBeats = 0;
    for (const st of t.staves) for (const b of st.bars) for (const v of b.voices) for (const be of v.beats) {
      if (be.isRest) continue;
      notes += be.notes.length;
      if (be.lyrics?.some((s) => s)) lyricBeats++;
    }
    if (notes > 0 && !t.staves.some((s) => s.isPercussion)) out.push({ index: t.index, name: t.name, notes, lyricBeats });
  }
  const rank = (c: TrackChoice) => (c.lyricBeats > 0 ? 2 : 0) + (VOCAL_NAME.test(c.name) ? 1 : 0);
  return out.sort((a, b) => rank(b) - rank(a) || b.lyricBeats - a.lyricBeats);
}

export function buildSong(score: at.model.Score, trackIndex: number, fileName = ""): Song {
  const settings = new at.Settings();
  const midiFile = new at.midi.MidiFile();
  const gen = new at.midi.MidiFileGenerator(score, settings, new at.midi.AlphaSynthMidiFileHandler(midiFile));
  gen.generate();

  const backing = score.backingTrack?.rawAudioFile ?? null;
  // With a backing track, its sync points define the time axis; without one,
  // fresh sync points give the plain tempo map.
  const sync: SyncPoint[] = at.midi.MidiFileGenerator.generateSyncPoints(score, !backing);

  const track = score.tracks[trackIndex];
  const notes: VocalNote[] = [];
  let prev: VocalNote | null = null;
  // tickLookup.masterBars is in play order, so repeats and jumps are expanded.
  for (const mbl of gen.tickLookup.masterBars) {
    const bar = track.staves[0].bars[mbl.masterBar.index];
    if (!bar) continue;
    const voice = bar.voices.find((v) => v.beats.some((b) => !b.isRest)) ?? bar.voices[0];
    for (const beat of voice.beats) {
      if (beat.isRest || beat.notes.length === 0) { prev = null; continue; }
      const t0 = tickToSeconds(mbl.start + beat.playbackStart, sync);
      const t1 = tickToSeconds(mbl.start + beat.playbackStart + beat.playbackDuration, sync);
      if (prev && beat.notes.every((n) => n.isTieDestination)) { prev.end = t1; continue; }
      const raw = beat.lyrics?.[0]?.trim() ?? "";
      const joinNext = raw.endsWith("-");
      const n: VocalNote = {
        index: notes.length, start: t0, end: t1,
        pitches: beat.notes.map((x) => x.realValue).sort((a, b) => b - a),
        syllable: joinNext ? raw.slice(0, -1) : raw, joinNext, phrase: 0,
      };
      notes.push(n);
      prev = n;
    }
  }

  const phrases = splitPhrases(notes);
  const all = notes.flatMap((n) => n.pitches);
  const title = score.title || fileName.replace(/\.[^.]+$/, "");
  const artist = score.artist || "";
  return {
    title, artist, key: `${artist} - ${title}`.toLowerCase().trim(),
    trackIndex, trackName: track.name, notes, phrases, backingAudio: backing,
    pitchMin: all.length ? Math.min(...all) : 55, pitchMax: all.length ? Math.max(...all) : 72,
  };
}

/**
 * Lyric lines. Guitar Pro 7/8 stores lyrics per beat, so the author's line
 * breaks are gone; rebuild them. Lyric lines start with a capital ("I",
 * "I'm" etc. don't count), so break before a capitalised word after a rest
 * of 0.25 s or once the line has two words, and anywhere after a long rest
 * or before the line gets too long.
 */
export function splitPhrases(notes: VocalNote[], longGap = 1.6, maxChars = 46): Phrase[] {
  const phrases: Phrase[] = [];
  let chars = 0, words = 0;
  notes.forEach((n, i) => {
    const cur = phrases[phrases.length - 1];
    const prev = notes[i - 1];
    const wordStart = !prev || !prev.joinNext;
    const capital = wordStart && /^[A-ZÀ-Ý]/.test(n.syllable) && !/^I($|'|’)/.test(n.syllable);
    const rest = prev ? n.start - prev.end : Infinity;
    const brk = !cur || rest >= longGap
      || (capital && (words >= 2 || rest >= 0.25))
      || (wordStart && chars + n.syllable.length > maxChars);
    if (brk) {
      phrases.push({ first: i, last: i, start: n.start, end: n.end });
      chars = 0; words = 0;
    } else {
      cur.last = i;
      cur.end = n.end;
    }
    chars += n.syllable.length + (n.joinNext ? 0 : 1);
    if (wordStart && n.syllable) words++;
    n.phrase = phrases.length - 1;
  });
  return phrases;
}

/** Text of a phrase, joining hyphenated syllables. */
export function phraseText(notes: VocalNote[], p: Phrase): { text: string; spans: [number, number][] } {
  let text = "";
  const spans: [number, number][] = [];
  for (let i = p.first; i <= p.last; i++) {
    const s = notes[i].syllable;
    const a = text.length;
    text += s;
    spans.push([a, text.length]);
    if (s && !notes[i].joinNext && i < p.last) text += " ";
  }
  return { text, spans };
}
