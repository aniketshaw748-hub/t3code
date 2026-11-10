import type { DeliverableRegion, DeliverableUnitChange } from "@t3tools/contracts";

import {
  type Raster,
  rasterDifference,
  type UnitDifference,
  unionRegion,
  VIDEO_TOLERANCE,
} from "./perceptualDiff.ts";
import { alignUnits, withMoves } from "./unitAlignment.ts";

export interface TimelineShot {
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

export interface Timeline {
  readonly duration: number;
  readonly shots: ReadonlyArray<TimelineShot>;
  /** Frames sampled at a fixed rate, in time order. */
  readonly samples: ReadonlyArray<{ readonly t: number; readonly frame: Raster }>;
}

/** Splits a file of back-to-back `grid` x `grid` RGB frames sampled at `fps` into timed samples. */
export function samplesFromBytes(
  bytes: Uint8Array,
  fps: number,
  grid: number,
): Timeline["samples"] {
  const size = grid * grid * 3;
  const samples: Array<Timeline["samples"][number]> = [];
  for (let offset = 0; offset + size <= bytes.length; offset += size) {
    samples.push({
      t: offset / size / fps,
      frame: { width: grid, height: grid, data: bytes.subarray(offset, offset + size) },
    });
  }
  return samples;
}

/** Side of the brightness grid a frame is reduced to for finding the same moment in both videos. */
const FINGERPRINT_GRID = 8;
/** A fingerprint cell differs past this step (0-255); a re-encode stays well under it. */
const FINGERPRINT_THRESHOLD = 10;
/**
 * Frames differing in more than this share of their cells are not one moment with an edit on
 * it, and are never paired: unlike slides, footage has no place that alone makes it the same.
 */
const SAME_FRAME_BELOW = 0.25;
/** A shot found at another place is the same shot only while it pairs this cheaply (0-1). */
const MOVED_BELOW = 0.5;
/**
 * Fewer samples than this without a partner, inside a shot that has partners, is the sampling
 * grid falling differently on a shifted shot, not material added or cut.
 */
const MIN_RUN = 2;

function fingerprint({ width, height, data }: Raster): Uint8Array {
  const cells = new Uint8Array(FINGERPRINT_GRID * FINGERPRINT_GRID);
  for (let cy = 0; cy < FINGERPRINT_GRID; cy++) {
    const y0 = Math.floor((cy * height) / FINGERPRINT_GRID);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / FINGERPRINT_GRID));
    for (let cx = 0; cx < FINGERPRINT_GRID; cx++) {
      const x0 = Math.floor((cx * width) / FINGERPRINT_GRID);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / FINGERPRINT_GRID));
      let sum = 0;
      for (let y = y0; y < y1; y++) {
        for (let o = (y * width + x0) * 3; o < (y * width + x1) * 3; o++) sum += data[o]!;
      }
      cells[cy * FINGERPRINT_GRID + cx] = sum / ((y1 - y0) * (x1 - x0) * 3);
    }
  }
  return cells;
}

function fingerprintDifference(a: Uint8Array, b: Uint8Array): number {
  let differing = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) > FINGERPRINT_THRESHOLD) differing++;
  }
  return differing / a.length;
}

/** The samples inside each shot; a shot too short to hold one borrows the sample nearest it. */
function samplesByShot(timeline: Timeline) {
  const own = timeline.shots.map((): number[] => []);
  const shotOf = new Int32Array(timeline.samples.length).fill(-1);
  let shot = 0;
  for (const [index, sample] of timeline.samples.entries()) {
    while (shot < timeline.shots.length - 1 && sample.t >= timeline.shots[shot]!.end) shot++;
    const candidate = timeline.shots[shot];
    if (candidate === undefined || sample.t < candidate.start || sample.t >= candidate.end)
      continue;
    own[shot]!.push(index);
    shotOf[index] = shot;
  }
  const seen = timeline.shots.map((candidate, index) => {
    if (own[index]!.length > 0 || timeline.samples.length === 0) return own[index]!;
    const middle = (candidate.start + candidate.end) / 2;
    let nearest = 0;
    for (const [sampleIndex, sample] of timeline.samples.entries()) {
      if (Math.abs(sample.t - middle) < Math.abs(timeline.samples[nearest]!.t - middle)) {
        nearest = sampleIndex;
      }
    }
    return [nearest];
  });
  return { own, seen, shotOf };
}

/** Which moment of one video is which of the other, found by what the frames show. */
export interface TimelineAlignment {
  readonly base: Timeline;
  readonly target: Timeline;
  /** For each sample of `target`, the sample of `base` showing the same moment, or -1. */
  readonly partner: Int32Array;
  /** 1 for each sample of `base` that some sample of `target` is paired with. */
  readonly baseTaken: Uint8Array;
  readonly baseShots: ReturnType<typeof samplesByShot>;
  readonly targetShots: ReturnType<typeof samplesByShot>;
  /** Shots of `target` that are a shot of `base` put at another place, by shot index. */
  readonly movedFrom: ReadonlyMap<number, number>;
  /** Shots of `target` that stand where a shot of `base` stood, with other footage in them. */
  readonly replacedFrom: ReadonlyMap<number, number>;
}

/**
 * Lines two videos up by content, not by the clock: a second added at the start leaves every later
 * shot paired with itself. Costs one small comparison per pair of samples, which the sample
 * budget keeps to a fraction of a second.
 */
export function alignTimelines(base: Timeline, target: Timeline): TimelineAlignment {
  const baseFingerprints = base.samples.map((sample) => fingerprint(sample.frame));
  const targetFingerprints = target.samples.map((sample) => fingerprint(sample.frame));
  const frameCost = (i: number, j: number) =>
    fingerprintDifference(baseFingerprints[i]!, targetFingerprints[j]!) / SAME_FRAME_BELOW;
  const partner = new Int32Array(target.samples.length).fill(-1);
  const baseTaken = new Uint8Array(base.samples.length);
  for (const pair of alignUnits(base.samples.length, target.samples.length, frameCost)) {
    if (pair.baseIndex === null || pair.targetIndex === null) continue;
    partner[pair.targetIndex] = pair.baseIndex;
    baseTaken[pair.baseIndex] = 1;
  }
  const baseShots = samplesByShot(base);
  const targetShots = samplesByShot(target);

  // A whole shot with no partner on either side may be one shot, moved.
  const alone = (samples: ReadonlyArray<number>, taken: (sample: number) => boolean) =>
    samples.length > 0 && !samples.some(taken);
  const removed = base.shots.filter((shot) =>
    alone(baseShots.own[shot.index]!, (sample) => baseTaken[sample] === 1),
  );
  const added = target.shots.filter((shot) =>
    alone(targetShots.own[shot.index]!, (sample) => partner[sample]! >= 0),
  );
  const shotCost = (baseShot: number, targetShot: number) => {
    const from = baseShots.own[baseShot]!;
    const to = targetShots.own[targetShot]!;
    if (Math.abs(from.length - to.length) > Math.max(1, Math.max(from.length, to.length) / 10)) {
      return 1;
    }
    let sum = 0;
    for (const [position, sample] of to.entries()) {
      sum += frameCost(from[Math.min(position, from.length - 1)]!, sample);
    }
    return Math.min(1, sum / to.length);
  };
  const movedFrom = new Map<number, number>();
  const moves = withMoves(
    [
      ...removed.map((shot) => ({ baseIndex: shot.index, targetIndex: null })),
      ...added.map((shot) => ({ baseIndex: null, targetIndex: shot.index })),
    ],
    shotCost,
    MOVED_BELOW,
  );
  for (const move of moves) {
    if (move.moved === true) movedFrom.set(move.targetIndex!, move.baseIndex!);
  }

  // A new shot that starts exactly where a dropped one started was put in its place.
  const replacedFrom = new Map<number, number>();
  const dropped = new Map(
    removed
      .filter((shot) => !new Set(movedFrom.values()).has(shot.index))
      .map((shot) => [baseShots.own[shot.index]![0]!, shot.index]),
  );
  for (const shot of added) {
    if (movedFrom.has(shot.index)) continue;
    let before = targetShots.own[shot.index]![0]! - 1;
    while (before >= 0 && partner[before]! < 0) before--;
    const replaced = dropped.get(before < 0 ? 0 : partner[before]! + 1);
    if (replaced !== undefined) replacedFrom.set(shot.index, replaced);
  }
  return { base, target, partner, baseTaken, baseShots, targetShots, movedFrom, replacedFrom };
}

/** The longest stretch of neighbouring samples in `samples` that `lacking` holds for. */
function longestRun(samples: ReadonlyArray<number>, lacking: (sample: number) => boolean): number {
  let longest = 0;
  let run = 0;
  for (const [position, sample] of samples.entries()) {
    const joins = position > 0 && samples[position - 1] === sample - 1;
    run = lacking(sample) ? (joins ? run + 1 : 1) : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

/**
 * What changed in one shot of `target`, against the moments of `base` it lines up with. A shot
 * with no partner anywhere is added; one found at another place is moved.
 */
export function shotChange(
  alignment: TimelineAlignment,
  shot: TimelineShot,
): DeliverableUnitChange {
  const { base, target, partner, baseTaken, baseShots, targetShots } = alignment;
  const time = { kind: "time", t: shot.start, tEnd: shot.end } as const;
  const samples = targetShots.seen[shot.index] ?? [];

  /** A frame against its partner, or a neighbour of it when the sampling grid fell between. */
  const frameChange = (baseSample: number, targetSample: number): UnitDifference => {
    const frame = target.samples[targetSample]!.frame;
    let best = rasterDifference(base.samples[baseSample]!.frame, frame, VIDEO_TOLERANCE);
    for (const near of [baseSample - 1, baseSample + 1]) {
      const other = base.samples[near];
      if (best.difference === 0 || other === undefined) continue;
      const found = rasterDifference(other.frame, frame, VIDEO_TOLERANCE);
      if (found.difference < best.difference) best = found;
    }
    return best;
  };
  const measure = (pairs: ReadonlyArray<readonly [baseSample: number, targetSample: number]>) => {
    let difference = 0;
    let region: DeliverableRegion | null = null;
    for (const [baseSample, targetSample] of pairs) {
      const found = frameChange(baseSample, targetSample);
      region = unionRegion(region, found.region);
      difference = Math.max(difference, found.difference);
    }
    return { difference, region };
  };
  const placed = (region: DeliverableRegion | null) =>
    region === null ? time : { ...time, region };

  const movedFrom = alignment.movedFrom.get(shot.index);
  const wholeShot = movedFrom ?? alignment.replacedFrom.get(shot.index);
  if (wholeShot !== undefined) {
    const from = baseShots.own[wholeShot]!;
    const { difference, region } = measure(
      samples.map((sample, position) => [from[Math.min(position, from.length - 1)]!, sample]),
    );
    return {
      status: movedFrom === undefined ? "changed" : "moved",
      baseIndex: wholeShot,
      targetIndex: shot.index,
      difference,
      anchor: placed(region),
    };
  }

  const paired = samples.filter((sample) => partner[sample]! >= 0);
  if (paired.length === 0) {
    return {
      status: "added",
      baseIndex: null,
      targetIndex: shot.index,
      difference: 1,
      anchor: time,
    };
  }
  const votes = new Map<number, number>();
  for (const sample of paired) {
    const baseShot = baseShots.shotOf[partner[sample]!]!;
    if (baseShot >= 0) votes.set(baseShot, (votes.get(baseShot) ?? 0) + 1);
  }
  const baseIndex = [...votes].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const { difference: pixels, region } = measure(
    paired.map((sample) => [partner[sample]!, sample]),
  );
  // Material put into the shot, or cut out of the shot it was made from.
  const inserted = longestRun(samples, (sample) => partner[sample]! < 0);
  const cut =
    baseIndex === null
      ? 0
      : longestRun(baseShots.own[baseIndex]!, (sample) => baseTaken[sample] === 0);
  const retimed = Math.max(
    inserted >= MIN_RUN ? inserted / samples.length : 0,
    cut >= MIN_RUN ? cut / (paired.length + cut) : 0,
  );
  const difference = Math.max(pixels, retimed);
  return {
    status: difference > 0 ? "changed" : "unchanged",
    baseIndex,
    targetIndex: shot.index,
    difference,
    anchor: difference > 0 ? placed(region) : null,
  };
}

/** Shots of `base` that no moment of `target` shows any more. */
export function removedShots(alignment: TimelineAlignment): ReadonlyArray<DeliverableUnitChange> {
  const moved = new Set([...alignment.movedFrom.values(), ...alignment.replacedFrom.values()]);
  return alignment.base.shots
    .filter((shot) => {
      const samples = alignment.baseShots.own[shot.index]!;
      return (
        samples.length > 0 &&
        !moved.has(shot.index) &&
        !samples.some((sample) => alignment.baseTaken[sample] === 1)
      );
    })
    .map((shot) => ({
      status: "removed",
      baseIndex: shot.index,
      targetIndex: null,
      difference: 1,
      anchor: { kind: "time", t: shot.start, tEnd: shot.end },
    }));
}

/** Per-shot changes between two videos lined up by content. */
export function compareTimelines(
  base: Timeline,
  target: Timeline,
): ReadonlyArray<DeliverableUnitChange> {
  const alignment = alignTimelines(base, target);
  return [...target.shots.map((shot) => shotChange(alignment, shot)), ...removedShots(alignment)];
}
