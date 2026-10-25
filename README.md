# Vocals Trainer

Sing along to your own Guitar Pro tabs, Yousician-style, in the browser.

Open a `.gp` file that has a vocal track and the app shows the melody as a
scrolling piano roll, with each syllable on its note and the lyric line
underneath. A ball follows the pitch you sing into the microphone, leaving a
trail. Notes turn green when you hit them and red when you miss them. The
tab's own backing track plays along, and you can slow it down without
changing its pitch.

## Use it

1. Open the app in Chrome or Edge: the hosted page,
   **https://mlemczyk.github.io/Guitar-Pro-Vocal-Trainer/**, or `npm run dev`
   locally. Your tabs never leave your computer; the page reads them in the
   browser.
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
| 🎯 Tune | A tuner with no song: the note you're singing, cents off, a pitch trace, and the range of notes you've held. Also measures the mic latency (below). |
| Stats | Saved scores per song, the lines you miss most (click one to jump to it), and every song you've practised. |
| ⚙ | Mic latency offset, on-pitch tolerance, look-ahead, mic sensitivity. |

A run is saved when the song ends, or when you jump, restart or change the
speed after at least 8 notes have been judged. Notes are only judged while
the mic is on. Scores are kept in this browser (IndexedDB). **Export** and
**Import** in the Stats panel move them to another computer.

### Latency

Sound takes time to reach your ears, and your voice takes time to reach the
app. Measure it once per microphone in **🎯 Tune**:

- **Sing on the clicks** (with headphones): four count-in clicks, then sing a
  short "ta" on each of the next 12. This measures everything between what
  you hear and what the app judges, including Bluetooth delay, so it's the
  one to use.
- **Loopback**: hold the headphones to the mic, or play through speakers, and
  stay quiet while 10 clicks play. This measures the audio system alone.

Either one sets **Mic latency offset** (in ⚙), which is remembered per
microphone. You can also set it by ear: if your trail lands consistently to
the right of notes you sang in time, raise it; if it lands to the left, lower
it.

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
- Loop a line, and a key transpose of the backing track.
- **Phones (Chrome on Android)**, once hosted on HTTPS: a landscape layout
  with a compact toolbar, touch controls, a screen wake lock, and a web app
  manifest so it installs to the home screen and works offline. Use wired or
  USB-C headphones; Bluetooth adds 150–300 ms that the browser misreports.

## Licence

Public domain ([Unlicense](LICENSE)).
