import { useEffect, useMemo, useRef, useState } from "react";
import type { SegmentOut } from "../api/types";
import { boundaryUpdates, type SegmentUpdate } from "./chartLayout";
import { buildBars } from "./barLayout";
import { timeForBeat } from "./beatGrid";
import { beatSlashMarks, clampBeatBoundary } from "./beatMath";
import { paintChordFill } from "./chordProgress";
import { chordLabel } from "../api/music";
import { barBeatAt, formatMusicalPosition, type BeatGridInfo } from "./musicalPosition";

export type { SegmentUpdate };

interface Props {
  segments: SegmentOut[];
  beatsPerMeasure: number;
  measureOffset: number;
  duration: number;
  currentTime: number;
  /** The chart's beat grid, so each cell can announce WHERE it is ("bar 3, beat 1") —
   *  the thing a sighted player reads off the page instantly and a screen reader could not
   *  say at all. */
  grid: BeatGridInfo;
  playing?: boolean;
  rate?: number;
  selectedId: string | null;
  /** Chords the player has yet to name (practice mode). A masked cell keeps its beats — the
   *  rhythm is the question's context — but shows "?" for the chord, and drops the roman
   *  numeral, which against a known key would hand over the answer. */
  maskedIds?: ReadonlySet<string>;
  /** True while the chart is in the masking regime (practice mode). It gates the
   *  reveal-as-reward: a chord leaves the masked set when it is NAMED — but also when the
   *  player exits practice ("Show the chords"), which empties the whole mask at once. Only
   *  the first is a reward; `masking` goes false on the second, so that bulk transition is
   *  swallowed instead of settle-animating the entire chart. */
  masking?: boolean;
  onSelect: (segmentId: string) => void;
  onSeek?: (time: number) => void;
  onResizeCommit?: (updates: SegmentUpdate[]) => void;
}

// Horizontal pointer movement -> beats for the resize handles.
const BEATS_PER_PIXEL = 0.05;

const NO_MASK: ReadonlySet<string> = new Set();

export default function Timeline({
  segments,
  beatsPerMeasure,
  measureOffset,
  currentTime,
  playing = false,
  rate = 1,
  selectedId,
  maskedIds = NO_MASK,
  masking = false,
  grid,
  onSelect,
  onSeek,
  onResizeCommit,
}: Props) {
  // Layout is by beats; playback positioning uses the derived seconds.
  const ordered = useMemo(
    () => [...segments].sort((a, b) => a.start_beat - b.start_beat),
    [segments],
  );
  const indexById = useMemo(
    () => new Map(ordered.map((s, i) => [s.id, i] as const)),
    [ordered],
  );
  const bars = useMemo(
    () => buildBars(ordered, beatsPerMeasure, measureOffset),
    [ordered, beatsPerMeasure, measureOffset],
  );
  const segmentById = useMemo(() => new Map(ordered.map((s) => [s.id, s])), [ordered]);
  const suppressClick = useRef(false);

  // The chord under the playhead, derived from currentTime (seconds). A precise
  // timer advances it exactly at the chord boundary so the highlight switches on
  // time instead of waiting for the next (~4Hz) timeupdate.
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    const active =
      ordered.find((s) => currentTime >= s.start_time && currentTime < s.end_time) ?? null;
    setActiveId(active?.id ?? null);
    if (!playing || !active) return;
    const remainingMs = ((active.end_time - currentTime) / (rate || 1)) * 1000;
    const timer = window.setTimeout(() => {
      const next = ordered.find((s) => s.start_time >= active.end_time) ?? null;
      setActiveId(next?.id ?? null);
    }, Math.max(0, remainingMs));
    return () => window.clearTimeout(timer);
  }, [ordered, currentTime, playing, rate]);

  // ONE FILL PER BOX of the active chord. A chord vamping across eight bars is eight boxes, and
  // .chord-progress answers exactly one question — how much of this chord is left? A fill pinned
  // to the first box would finish eight bars early and answer nothing.
  const fillRefs = useRef(new Map<string, HTMLSpanElement>());

  // Each box's own start/end time. Times come from timeForBeat — NOT from interpolating the
  // segment's own start_time/end_time, which would be a second implementation of beat<->time
  // that drifts against the grid (CLAUDE.md: one home per side). `isChordStart` rides along so
  // the effect can tell the chord's FIRST box (which must arm even when the media clock lags
  // just short of the chord's start) from a genuinely-future box (which must stay empty).
  const activeFills = useMemo(() => {
    const out = new Map<
      string,
      { startTime: number; endTime: number; isChordStart: boolean }
    >();
    if (!activeId) return out;
    for (const bar of bars) {
      for (const f of bar.fragments) {
        if (f.segmentId !== activeId) continue;
        out.set(`${f.segmentId}-${bar.index}`, {
          startTime: timeForBeat(f.startBeat, grid.beatTimes, grid.bpm, grid.duration),
          endTime: timeForBeat(f.startBeat + f.beats, grid.beatTimes, grid.bpm, grid.duration),
          isChordStart: f.isChordStart,
        });
      }
    }
    return out;
  }, [activeId, bars, grid]);

  useEffect(() => {
    for (const [key, { startTime, endTime, isChordStart }] of activeFills) {
      const el = fillRefs.current.get(key);
      if (!el) continue;
      if (currentTime >= endTime) {
        el.style.transition = "none";
        el.style.transform = "scaleX(1)";   // already played
      } else if (currentTime < startTime && !isChordStart) {
        // A genuinely-future box of a multi-bar vamp. paintChordFill CLAMPS currentTime into
        // the window it is handed, so a future box would paint scaleX(0) and then transition to
        // full over its OWN duration — hand it every unplayed box and the whole vamp fills at
        // once. Future boxes are therefore set empty with no transition. The chord's FIRST box
        // is excluded from this branch: when the media clock lags just short of the chord's
        // start (the boundary timer has flipped the active chord but timeupdate hasn't caught
        // up), that first box IS the sounding box and must arm its transition — paintChordFill's
        // clamp turns the stale reading into a clean scaleX(0) start.
        el.style.transition = "none";
        el.style.transform = "scaleX(0)";   // not yet
      } else {
        // The box that is actually sounding (or the first box under a lagging clock).
        paintChordFill(el, { startTime, endTime, currentTime, playing, rate });
      }
    }
  }, [activeFills, currentTime, playing, rate]);

  // Reveal-as-reward: when a chord is named it leaves the masked set, and the cell it was
  // hiding in should settle the chord into place — the reward IS the information appearing,
  // a channel a colourblind player gets in full, unlike a green flash. We track the ids that
  // have EVER left the masked set this sitting; the set only grows, so each cell gets the
  // flag once and CSS plays the settle once (an animation runs only when first applied to an
  // element). No timer, no replay, and — crucially — nothing fires on first paint, because a
  // cell that was masked from the start never "transitioned" out of it.
  const prevMasked = useRef<ReadonlySet<string>>(maskedIds);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(NO_MASK);
  useEffect(() => {
    // Gate on `masking`: a chord leaving the masked set is only a reward while we are still
    // in practice. Exiting practice empties the mask (masking goes false) — that bulk
    // transition is swallowed here (prevMasked stays in sync) so the whole chart does not
    // settle-animate for chords the player never named.
    const newly = masking
      ? [...prevMasked.current].filter((id) => !maskedIds.has(id))
      : [];
    prevMasked.current = maskedIds;
    if (newly.length === 0) return;
    setRevealed((prev) => {
      const next = new Set(prev);
      newly.forEach((id) => next.add(id));
      return next;
    });
  }, [maskedIds, masking]);

  function startResize(index: number, edge: "left" | "right", e: React.PointerEvent) {
    e.stopPropagation();
    suppressClick.current = false;
    if (!onResizeCommit) return;
    const seg = ordered[index];
    const left = edge === "left" ? ordered[index - 1] : seg;
    const right = edge === "left" ? seg : ordered[index + 1];
    const oldBoundary = edge === "left" ? seg.start_beat : seg.end_beat;
    const lower = left ? left.start_beat : 0;
    const upper = right ? right.end_beat : oldBoundary + beatsPerMeasure;
    const startX = e.clientX;

    const move = (ev: PointerEvent) => ev.preventDefault();
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      suppressClick.current = true;
      const db = (ev.clientX - startX) * BEATS_PER_PIXEL;
      const boundary = clampBeatBoundary(oldBoundary + db, lower, upper);
      const updates = boundaryUpdates(left, right, oldBoundary, boundary);
      if (updates.length) onResizeCommit(updates);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <ul className="chart-bars" aria-label="Chord chart">
      {bars.map((bar) => (
        // A BAR is a real musical object, but it is not a list entry — the CHORDS are the
        // list. A chord spanning eight bars is one chord in eight boxes, and role="presentation"
        // is what keeps a screen-reader user from being told about the seven splits that a
        // different time signature would move.
        <li key={bar.index} className="chart-bar" role="presentation">
          {bar.fragments.map((f) => {
            const s = segmentById.get(f.segmentId)!;
            const i = indexById.get(s.id)!;
            const selected = s.id === selectedId;
            const isActive = s.id === activeId;
            const masked = maskedIds.has(s.id);
            const chordBeats = Math.max(0.5, s.end_beat - s.start_beat);

            const label = [
              masked ? "Hidden chord" : chordLabel(s.chord_root, s.chord_quality),
              formatMusicalPosition(barBeatAt(grid, s.start_time)),
              `${chordBeats} ${chordBeats === 1 ? "beat" : "beats"}`,
            ].join(", ");

            const body = (
              <>
                <strong>{masked ? "?" : chordLabel(s.chord_root, s.chord_quality)}</strong>
                <span className="muted slash-marks">{beatSlashMarks(f.beats)}</span>
                <span className="muted">{masked ? "" : s.roman_numeral}</span>
                {/* Every box of the active chord gets a fill — the effect above decides which
                    are full, which are empty, and which is sweeping. */}
                {isActive && (
                  <span
                    ref={(el) => {
                      const key = `${s.id}-${bar.index}`;
                      if (el) fillRefs.current.set(key, el);
                      else fillRefs.current.delete(key);
                    }}
                    aria-hidden
                    className="chord-progress"
                    style={{ transform: "scaleX(0)" }}
                  />
                )}
              </>
            );

            const dataAttrs = {
              "data-segment-id": s.id,
              "data-selected": selected ? "true" : undefined,
              "data-playing": isActive ? "true" : undefined,
              "data-masked": masked ? "true" : undefined,
              "data-revealed": revealed.has(s.id) ? "true" : undefined,
            } as const;

            // A CONTINUATION box: the same chord, still sounding, in a later bar. It is
            // aria-hidden and unfocusable so the chord is announced once and takes one tab
            // stop — but it stays clickable, because a player aiming at any box of a vamp
            // means "this chord". The chord's real END may land on a continuation box (a vamp
            // ends on its last box, which is never the first), so the RIGHT resize handle
            // rides `isChordEnd` wherever it falls — the left handle stays on the first box.
            //
            // There is no separate button here, so this single element plays both parts: the
            // chord-cell appearance AND the flex child of .chart-bar — hence both classes.
            if (!f.isChordStart) {
              return (
                <span key={`${s.id}-${bar.index}`} {...dataAttrs}
                      className="chord-cell chord-cell__item" aria-hidden
                      // Runtime geometry ONLY: the fragment's width IS its beat count within
                      // this bar. It must sit here — this element is the flex child of
                      // .chart-bar.
                      style={{ flex: `${f.beats} 1 0` }}
                      onClick={() => {
                        // Same guard as the button: swallow the click the browser fires after a
                        // pointer drag that began on this box's resize handle (a vamp's right
                        // handle lives here), so a resize never doubles as a select + seek.
                        if (suppressClick.current) { suppressClick.current = false; return; }
                        onSelect(s.id);
                        onSeek?.(s.start_time);
                      }}>
                  {body}
                  {onResizeCommit && f.isChordEnd && (
                    <span className="chord-cell__resize chord-cell__resize--right"
                      aria-label={`Resize end of ${chordLabel(s.chord_root, s.chord_quality)}`}
                      draggable={false}
                      onPointerDown={(e) => startResize(i, "right", e)}
                      onClick={(e) => e.stopPropagation()} />
                  )}
                </span>
              );
            }

            return (
              // The chord is ONE list entry (role="listitem") wrapping a real <button> — a
              // vamp spanning eight bars must still be one item, but the button's NATIVE role
              // must survive so assistive tech announces an activatable control, not a plain
              // list row. role="listitem" therefore sits on the outer <span>, which also
              // carries the flex geometry (it is the flex child of .chart-bar); the inner
              // <button> carries the interaction and the label.
              <span key={`${s.id}-${bar.index}`} role="listitem" className="chord-cell__item"
                style={{ flex: `${f.beats} 1 0` }}>
                <button type="button" className="chord-cell" {...dataAttrs}
                  aria-pressed={selected} aria-label={label}
                  onClick={() => {
                    if (suppressClick.current) { suppressClick.current = false; return; }
                    onSelect(s.id);
                    onSeek?.(s.start_time);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault(); // Space scrolls the page otherwise
                    onSelect(s.id);
                    onSeek?.(s.start_time);
                  }}
                >
                  {onResizeCommit && (
                    <span className="chord-cell__resize chord-cell__resize--left"
                      aria-label={`Resize start of ${chordLabel(s.chord_root, s.chord_quality)}`}
                      draggable={false}
                      onPointerDown={(e) => startResize(i, "left", e)}
                      onClick={(e) => e.stopPropagation()} />
                  )}
                  {body}
                  {onResizeCommit && f.isChordEnd && (
                    <span className="chord-cell__resize chord-cell__resize--right"
                      aria-label={`Resize end of ${chordLabel(s.chord_root, s.chord_quality)}`}
                      draggable={false}
                      onPointerDown={(e) => startResize(i, "right", e)}
                      onClick={(e) => e.stopPropagation()} />
                  )}
                </button>
              </span>
            );
          })}
        </li>
      ))}
    </ul>
  );
}
