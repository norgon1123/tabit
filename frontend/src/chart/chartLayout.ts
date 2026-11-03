import { snapHalfBeat } from "./beatMath";

interface BeatSpan { start_beat: number; end_beat: number; }

export interface SegmentUpdate {
  id: string;
  patch: { start_beat?: number; end_beat?: number };
}

// #2: moving the boundary between two adjacent chords. Patch the shrinking side first so a
// PATCH never transiently overlaps a neighbour (which the API would reject).
export function boundaryUpdates(
  left: { id: string } | undefined,
  right: { id: string } | undefined,
  oldBoundary: number,
  newBoundary: number,
): SegmentUpdate[] {
  if (newBoundary === oldBoundary) return [];
  const updates: SegmentUpdate[] = [];
  if (left) updates.push({ id: left.id, patch: { end_beat: newBoundary } });
  if (right) updates.push({ id: right.id, patch: { start_beat: newBoundary } });
  if (newBoundary > oldBoundary) updates.reverse();
  return updates;
}

const MIN_BEATS = 0.5;

// Resize chord[index] to `newLength`, conserving the total by taking beats from
// (or giving them to) the FOLLOWING chords so the run stays contiguous. Growing
// consumes the next chord first, then ripples into later chords down to MIN_BEATS;
// growth is capped at the followers' available slack. Shrinking gives the freed
// beats to the immediate next chord. The last chord (no followers) is clamped at
// `maxTotalBeats`. Returns the full ordered window list.
export function redistributeLength(
  segments: BeatSpan[],
  index: number,
  newLength: number,
  maxTotalBeats: number,
): { start_beat: number; end_beat: number }[] {
  const out = segments.map((s) => ({ start_beat: s.start_beat, end_beat: s.end_beat }));
  if (index < 0 || index >= out.length) return out;

  const edited = out[index];
  const oldLength = edited.end_beat - edited.start_beat;
  const followers = out.slice(index + 1);

  if (followers.length === 0) {
    const requested = Math.max(MIN_BEATS, snapHalfBeat(newLength));
    let end = snapHalfBeat(edited.start_beat + requested);
    if (maxTotalBeats > 0) end = Math.min(end, maxTotalBeats); // <=0 means no recording duration yet -> no cap
    edited.end_beat = end;
    return out;
  }

  const followerLengths = followers.map((s) => s.end_beat - s.start_beat);
  const slack = followerLengths.reduce((acc, len) => acc + (len - MIN_BEATS), 0);

  let delta = Math.max(MIN_BEATS, snapHalfBeat(newLength)) - oldLength;
  if (delta > 0) delta = Math.min(delta, slack); // can't reclaim more than the slack

  edited.end_beat = snapHalfBeat(edited.start_beat + oldLength + delta);

  let cursor = edited.end_beat;
  let toReclaim = delta > 0 ? delta : 0;
  followers.forEach((f, i) => {
    let len = followerLengths[i];
    if (toReclaim > 0) {
      const give = Math.max(0, Math.min(toReclaim, len - MIN_BEATS));
      len -= give;
      toReclaim -= give;
    } else if (delta < 0 && i === 0) {
      len += -delta; // the immediate next chord absorbs the freed beats
    }
    f.start_beat = snapHalfBeat(cursor);
    f.end_beat = snapHalfBeat(cursor + len);
    cursor = f.end_beat;
  });

  // The last segment's stored end_beat may sit on the (fractional) grid cap; snapHalfBeat
  // would round it UP past the cap and the server would 422. Clamp the tail so the
  // optimistic layout matches what the grid check accepts. (maxTotalBeats<=0 => no cap.)
  if (maxTotalBeats > 0) {
    const last = out[out.length - 1];
    if (last.end_beat > maxTotalBeats) last.end_beat = maxTotalBeats;
  }

  return out;
}
