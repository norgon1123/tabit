// Port of app/audio/beatgrid.py: convert the recording duration into the maximum
// end_beat the chart may reach. A grid is an ascending list of beat-onset seconds.
const DEFAULT_BPM = 120;

function ensureGrid(beatTimes: number[], bpm: number | null, duration: number): number[] {
  const clean = [...beatTimes].map(Number).sort((a, b) => a - b);
  if (clean.length >= 2) return backfillHead(clean);
  const tempo = bpm && bpm > 0 ? bpm : DEFAULT_BPM;
  const interval = 60 / tempo;
  const span = Math.max(duration, interval * 2);
  const n = Math.floor(span / interval) + 2;
  return Array.from({ length: n }, (_, i) => i * interval);
}

// Beat trackers often emit no onset until the groove settles, leaving the head of the
// recording off the grid; extend it back to t=0 so beat 0 is the start of the audio.
// The backend stores grids that are already backfilled, so this only matters for charts
// seeded before that fix; it is a no-op on a grid that already starts at 0.
function backfillHead(grid: number[]): number[] {
  const interval = grid[1] - grid[0];
  if (interval <= 0 || grid[0] <= 0) return grid;
  const n = Math.floor(grid[0] / interval);
  const head = Array.from({ length: n }, (_, i) => grid[0] - (n - i) * interval);
  return [...head, ...grid];
}

function intervalAt(grid: number[], i: number): number {
  const step =
    i >= 0 && i < grid.length - 1 ? grid[i + 1] - grid[i] : grid[grid.length - 1] - grid[grid.length - 2];
  return step > 0 ? step : 60 / DEFAULT_BPM;
}

export function totalBeats(beatTimes: number[], bpm: number | null, duration: number): number {
  const grid = ensureGrid(beatTimes, bpm, duration);
  if (duration <= grid[0]) return 0;
  const last = grid.length - 1;
  if (duration >= grid[last]) return last + (duration - grid[last]) / intervalAt(grid, last);
  let i = 0;
  while (i < last && grid[i + 1] <= duration) i += 1;
  return i + (duration - grid[i]) / intervalAt(grid, i);
}

/** Beat index -> seconds, clamped to [0, duration]. The inverse of totalBeats' mapping, and
 *  the port of app/audio/beatgrid.py::time_for_beat — keep the two in step.
 *
 *  Beat 0 is grid[0], which is not necessarily t=0, so positions below it extrapolate at the
 *  opening interval rather than collapsing to zero. */
export function timeForBeat(
  beat: number,
  beatTimes: number[],
  bpm: number | null,
  duration: number,
): number {
  const grid = ensureGrid(beatTimes, bpm, duration);
  const last = grid.length - 1;
  let seconds: number;
  if (beat <= 0) {
    seconds = grid[0] + beat * intervalAt(grid, 0);
  } else if (beat >= last) {
    seconds = grid[last] + (beat - last) * intervalAt(grid, last);
  } else {
    const i = Math.floor(beat);
    seconds = grid[i] + (beat - i) * intervalAt(grid, i);
  }
  return Math.max(0, Math.min(duration, seconds));
}
