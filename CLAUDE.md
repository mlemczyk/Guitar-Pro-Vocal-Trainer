# Vocals Trainer — notes for agents

A public (Unlicense) static web app: sing along to Guitar Pro tabs with a
scrolling vocal piano roll, a live pitch ball, hit/miss scoring, saved
per-song stats and pitch-preserving slow-down. README.md describes it for
users; this file holds what a developer needs that the code doesn't say.
Machine-specific paths on the owner's PC are in `CLAUDE.local.md`
(gitignored, not in the public repo).

## Keep it isolated

It was started from the owner's private bass-rig project but **shares
nothing with it**: no imports from there, no reads of its data. **No tabs,
song audio or stems in this repo**, ever (`.gitignore` blocks the usual
extensions, and `dev-tabs/` is for local test copies). Song names in docs
and tests are fine.

## Layout

- `src/song.ts`: `.gp` → `Song` (timed notes, syllables, phrases, backing
  audio) via alphaTab. Notes are walked through
  `MidiFileGenerator.tickLookup.masterBars`, which is in **play order**
  (repeats expanded). Times come from `generateSyncPoints()` through
  `timing.ts`.
- `src/timing.ts`: tick → backing-track seconds through sync points.
- `src/scoring.ts`: `Judge`, octave-folded per-note hit/miss.
- `src/player.ts`: Signalsmith Stretch node playing the decoded backing
  track, plus the guide-tone oscillators. Position comes from the
  AudioContext clock, minus output latency.
- `src/pitch.ts`: mic → AnalyserNode → pitchy (McLeod). `startFromNode()`
  is the `?sim` test mode.
- `src/view.ts`: canvas drawing only. `src/stats.ts`: IndexedDB attempts.
- `src/main.ts`: the UI wiring. Judging runs on a 16 ms `setInterval` and
  drawing on `requestAnimationFrame`. That way scoring continues in a
  background window (Chrome doesn't throttle timers in a tab playing audio).

## Facts worth keeping

- **Guitar Pro 7/8 lyrics are per beat; line breaks are lost.**
  `splitPhrases()` rebuilds lines from capitals, rests and length. Check a
  change against real tabs with `tests/real_tab.test.ts` (`VT_TAB=...`).
- Vocal tracks from Songsterr often use a wind or string instrument
  (saxophone, oboe, violin). Rank tracks by lyrics and name, never by
  instrument type.
- Vocal tracks can hold harmonies (chords): every note is drawn, and hitting
  any of them counts.
- A page stall (hidden tab, throttled timers) must not turn notes into
  misses: `Judge.skip()` leaves unobserved notes unjudged.
- **Testing in the Claude desktop app's browser pane:** a hidden pane
  throttles timers to about 1 Hz, so nothing gets judged. Show the pane
  before driving a `?sim` run. A test file is loaded by fetching
  `/dev-tabs/<name>.gp` and dispatching a synthetic `drop` event. In dev,
  `window.__vt` exposes the player, tracker, song and judge.
- Speed below 0.75x sounds smeary (a Signalsmith limit). Notes and lyrics
  stay correct.

## Run, test

`npm run dev` (port 5178), `npm test`, `npx tsc --noEmit -p .`,
`npm run build`. GitHub Pages deploys `dist/` from `main` via
`.github/workflows/pages.yml`.
