// Saved attempts, per song, in this browser's IndexedDB. Export/import as
// JSON moves them between machines.

export interface Attempt {
  id?: number;
  songKey: string;
  title: string;
  artist: string;
  track: string;
  date: string;          // ISO, local machine clock
  speed: number;         // playback rate, 1 = full speed
  transpose: number;     // octaves the target was shown shifted by
  startTime: number;     // song seconds the attempt started at
  endTime: number;
  judged: number;
  hit: number;
  percent: number;
  complete: boolean;     // reached the last note
  phraseHits: number[];
  phraseTotals: number[];
}

const DB = "vocals-trainer";
const STORE = "attempts";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      s.createIndex("songKey", "songKey");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAttempt(a: Attempt): Promise<void> {
  const db = await open();
  await done(db.transaction(STORE, "readwrite").objectStore(STORE).add(a));
}

export async function attemptsFor(songKey: string): Promise<Attempt[]> {
  const db = await open();
  const rows = await done(db.transaction(STORE).objectStore(STORE).index("songKey").getAll(songKey));
  return (rows as Attempt[]).sort((a, b) => b.date.localeCompare(a.date));
}

export async function allAttempts(): Promise<Attempt[]> {
  const db = await open();
  return (await done(db.transaction(STORE).objectStore(STORE).getAll())) as Attempt[];
}

export async function importAttempts(rows: Attempt[]): Promise<number> {
  const have = new Set((await allAttempts()).map((a) => `${a.songKey}|${a.date}`));
  const db = await open();
  const tx = db.transaction(STORE, "readwrite");
  let n = 0;
  for (const r of rows) {
    if (have.has(`${r.songKey}|${r.date}`)) continue;
    const { id: _drop, ...rest } = r;
    tx.objectStore(STORE).add(rest);
    n++;
  }
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  return n;
}

export interface SongSummary { songKey: string; title: string; artist: string; attempts: number; best: number; bestFull: number | null; last: string }

export function summarise(rows: Attempt[]): SongSummary[] {
  const by = new Map<string, SongSummary>();
  for (const r of rows) {
    const s = by.get(r.songKey) ?? { songKey: r.songKey, title: r.title, artist: r.artist, attempts: 0, best: 0, bestFull: null, last: "" };
    s.attempts++;
    s.best = Math.max(s.best, r.percent);
    if (r.complete && r.speed >= 0.999) s.bestFull = Math.max(s.bestFull ?? 0, r.percent);
    if (r.date > s.last) s.last = r.date;
    by.set(r.songKey, s);
  }
  return [...by.values()].sort((a, b) => b.last.localeCompare(a.last));
}

/** Per-phrase hit rate over the given attempts (null where never judged). */
export function phraseRates(rows: Attempt[], phraseCount: number): (number | null)[] {
  const hit = new Array(phraseCount).fill(0), tot = new Array(phraseCount).fill(0);
  for (const r of rows) {
    if (r.phraseTotals.length !== phraseCount) continue; // a different track or tab version
    r.phraseTotals.forEach((t, i) => { tot[i] += t; hit[i] += r.phraseHits[i]; });
  }
  return tot.map((t, i) => (t ? hit[i] / t : null));
}
