// MIDI tick -> seconds on the backing track, through Guitar Pro 8 sync points
// (as computed by alphaTab's MidiFileGenerator.generateSyncPoints).

export const TICKS_PER_QUARTER = 960;

export interface SyncPoint {
  synthTick: number;
  syncTime: number;  // ms in the backing track
  syncBpm: number;   // tempo that holds on the backing track after this point
}

export function tickToSeconds(tick: number, points: SyncPoint[]): number {
  if (points.length === 0) return (tick / TICKS_PER_QUARTER) * 0.5; // 120 BPM fallback
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].synthTick <= tick) lo = mid; else hi = mid - 1;
  }
  const p = points[lo];
  const ms = p.syncTime + ((tick - p.synthTick) / TICKS_PER_QUARTER) * (60000 / p.syncBpm);
  return ms / 1000;
}
