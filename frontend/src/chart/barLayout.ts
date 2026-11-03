/** Segments + meter -> bars. The chord sheet's layout unit is the BAR, not the chord.
 *
 * A chord that vamps for eight bars is ONE segment in the database and EIGHT fragments here:
 * the split is derived, never stored. That keeps the analysis truthful about what the engine
 * heard, keeps editing and resizing operating on real chord boundaries, and keeps a vamp from
 * asking the same practice question eight times.
 *
 * Pure and DOM-free on purpose — this is where the chart's geometry is decided, so it is the
 * thing that has to be cheap to test.
 */

interface BeatSpan {
  id: string;
  start_beat: number;
  end_beat: number;
}

export interface Fragment {
  segmentId: string;
  startBeat: number;
  beats: number;
  /** This fragment carries the chord's real start — where a resize handle belongs, and
   *  where the <button> and the screen-reader label go. */
  isChordStart: boolean;
  /** This fragment carries the chord's real end. */
  isChordEnd: boolean;
}

export interface Bar {
  index: number;
  startBeat: number;
  endBeat: number;
  fragments: Fragment[];
}

// Beats are half-beat-quantised at worst, so anything this small is float noise.
const EPS = 1e-6;

export function buildBars(
  segments: BeatSpan[],
  beatsPerMeasure: number,
  measureOffset: number,
): Bar[] {
  const ordered = [...segments].sort((a, b) => a.start_beat - b.start_beat);
  if (ordered.length === 0) return [];

  const span = Math.max(1, beatsPerMeasure);
  const offset = ((measureOffset % span) + span) % span;
  // A chart ends where its chords end — NOT at the recording's total_beats. Trailing audio
  // with no detected chords must not render as empty bars.
  const chartEnd = ordered[ordered.length - 1].end_beat;
  // A non-finite end_beat (NaN or Infinity) would never satisfy `edge >= chartEnd - EPS`
  // below, spinning the edge loop forever and hanging the UI thread. No current input
  // produces one, but a hang is too bad a failure mode for a one-line guard to skip.
  if (!Number.isFinite(chartEnd)) return [];

  // Bar edges: beat 0, every bar line at offset + k*span, then the chart's end. With
  // offset > 0 the leading [0, offset) span becomes a short pickup bar. `offset + k * span`
  // is computed from k rather than accumulated, so a long chart cannot drift.
  const edges: number[] = [0];
  for (let k = 0; ; k += 1) {
    const edge = offset + k * span;
    if (edge >= chartEnd - EPS) break;
    if (edge > EPS) edges.push(edge);
  }
  edges.push(chartEnd);

  const bars: Bar[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const startBeat = edges[i];
    const endBeat = edges[i + 1];
    if (endBeat - startBeat < EPS) continue;

    const fragments: Fragment[] = [];
    for (const s of ordered) {
      const from = Math.max(s.start_beat, startBeat);
      const to = Math.min(s.end_beat, endBeat);
      if (to - from < EPS) continue; // this chord does not sound in this bar
      fragments.push({
        segmentId: s.id,
        startBeat: from,
        beats: to - from,
        isChordStart: s.start_beat >= startBeat - EPS,
        isChordEnd: s.end_beat <= endBeat + EPS,
      });
    }
    bars.push({ index: bars.length, startBeat, endBeat, fragments });
  }
  return bars;
}
