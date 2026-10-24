# Vocals Trainer

Sing along to your own Guitar Pro tabs, Yousician-style, in the browser.

Open a `.gp` file that has a vocal track and the app shows the melody as a
scrolling piano roll, with each syllable on its note and the lyric line
underneath. A ball follows the pitch you sing into the microphone, leaving a
trail. Notes turn green when you hit them and red when you miss them. The
tab's own backing track plays along, and you can slow it down without
changing its pitch.

## Use it

1. Open the app in Chrome or Edge, either the hosted page or `npm run dev`
   locally.
2. **Open tab** (or drop a `.gp` file on the page). The vocal track is picked
   automatically: the track with lyrics, or one named like "Vocals". Change
   it in the track list.
3. **🎤 Mic off** → allow the microphone, and pick the input from the list
   next to it.
4. **Space** plays and pauses.

**Use headphones.** If the band comes out of speakers, the microphone hears
it too and the ball follows the band instead of you.

| Control | What it does |
|---|---|
| Speed (50–100 %, `[` `]`) | Slows the backing track, the guide tone and the scrolling. Pitch is kept. |
| Octave | Draws the melody (and plays the guide) an octave up or down. Octaves always count as hits. |
| Guide | Plays the melody as a soft tone, for learning a song. |
| Band | Backing-track volume. |
| ← / →, click the roll | Jump 5 s, or jump to the clicked spot. |
| Stats | Saved scores per song, the lines you miss most (click one to jump to it), and every song you've practised. |
| ⚙ | Mic latency offset, on-pitch tolerance, look-ahead, mic sensitivity. |

A run is saved when the song ends, or when you jump, restart or change the
speed after at least 8 notes have been judged. Notes are only judged while
the mic is on. Scores are kept in this browser (IndexedDB). **Export** and
**Import** in the Stats panel move them to another computer.

### Latency

The backing track's output latency is taken into account automatically.
What's left is the microphone's input latency plus the pitch analysis window,
about 60 ms by default. If your trail lands consistently to the right of
notes you sang in time, raise **Mic latency offset** in ⚙. If it lands to
the left, lower it.

### What a tab needs

A vocal melody track. Lyrics are optional but make it far nicer. Tabs from
Songsterr often carry the vocal line on an instrument like "saxophone" or
"oboe" named "Vocals"; that works. If the tab has an embedded backing track
(Guitar Pro 7/8 audio track), it plays, kept in sync through the tab's own
sync points. Without one, only the guide tone plays.

## Develop

```
npm install
npm run dev      # http://localhost:5178 ; add ?sim to let the guide tone stand in for a singer
npm test
npm run build    # static site in dist/
```

`VT_TAB=path/to/song.gp npx vitest run tests/real_tab.test.ts` checks the
loader against a real tab. Tabs and audio never go in this repo.

## Built on

- [alphaTab](https://github.com/CoderLine/alphaTab) (MPL-2.0) reads the
  Guitar Pro files, lyrics, backing track and sync points.
- [Signalsmith Stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch)
  (MIT) slows the audio down without changing its pitch.
- [pitchy](https://github.com/ianprime0509/pitchy) (0BSD) detects pitch
  with the McLeod pitch method.

The screen follows the SingStar / UltraStar / Yousician convention. No code
from those projects is used.

## Roadmap

- **Backing-track variants**: choose with vocals (to learn the song) or
  without (to sing it), and with bass or without (to sing while someone plays
  bass live). This needs stems made once per song by source separation; the
  app would load them next to the `.gp` file and mix them live.
- Loop a line, a key transpose of the backing track, and a calibration step
  for the mic latency.

## Licence

Public domain ([Unlicense](LICENSE)).
