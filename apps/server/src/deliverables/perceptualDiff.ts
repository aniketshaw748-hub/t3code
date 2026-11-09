import type { DeliverableRegion, DeliverableUnitChange } from "@t3tools/contracts";

/** Side of the RGB grid a unit is reduced to before comparison. */
export const SIGNATURE_GRID = 32;
/** Bytes in one signature: RGB, so a colour swap at equal brightness still counts. */
const SIGNATURE_BYTES = SIGNATURE_GRID * SIGNATURE_GRID * 3;
/** A grid cell counts as changed past this step in any channel (0-255); below it is codec noise. */
const CELL_THRESHOLD = 24;
/** A unit counts as changed once this fraction of its cells changed (4 of 1024). */
const CHANGE_THRESHOLD = 0.004;
const GAP_COST = 0.5;

export type UnitSignature =
  | { readonly type: "pixels"; readonly data: Uint8Array }
  | { readonly type: "hash"; readonly value: string };

export interface UnitDifference {
  readonly difference: number;
  readonly region: DeliverableRegion | null;
}

/** Fraction of grid cells that changed, and the box around them. */
export function pixelDifference(a: Uint8Array, b: Uint8Array): UnitDifference {
  const cells = SIGNATURE_GRID * SIGNATURE_GRID;
  if (a.length !== SIGNATURE_BYTES || b.length !== SIGNATURE_BYTES) {
    return { difference: 1, region: { x: 0, y: 0, w: 1, h: 1 } };
  }
  let changed = 0;
  let minX = SIGNATURE_GRID;
  let minY = SIGNATURE_GRID;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < cells; i++) {
    const o = i * 3;
    const step = Math.max(
      Math.abs(a[o]! - b[o]!),
      Math.abs(a[o + 1]! - b[o + 1]!),
      Math.abs(a[o + 2]! - b[o + 2]!),
    );
    if (step <= CELL_THRESHOLD) continue;
    changed++;
    const x = i % SIGNATURE_GRID;
    const y = Math.floor(i / SIGNATURE_GRID);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (changed === 0) return { difference: 0, region: null };
  return {
    difference: changed / cells,
    region: {
      x: minX / SIGNATURE_GRID,
      y: minY / SIGNATURE_GRID,
      w: (maxX - minX + 1) / SIGNATURE_GRID,
      h: (maxY - minY + 1) / SIGNATURE_GRID,
    },
  };
}

function unitDifference(a: UnitSignature, b: UnitSignature): UnitDifference {
  if (a.type === "pixels" && b.type === "pixels") return pixelDifference(a.data, b.data);
  if (a.type === "hash" && b.type === "hash") {
    return a.value === b.value ? { difference: 0, region: null } : { difference: 1, region: null };
  }
  return { difference: 1, region: null };
}

export interface AlignedPair {
  readonly baseIndex: number | null;
  readonly targetIndex: number | null;
}

/**
 * Aligns two ordered unit lists so inserted or deleted slides line up instead of shifting every
 * later slide into "changed". Matching costs the difference; skipping a unit costs a fixed gap.
 */
export function alignUnits(
  baseCount: number,
  targetCount: number,
  difference: (baseIndex: number, targetIndex: number) => number,
): ReadonlyArray<AlignedPair> {
  const width = targetCount + 1;
  const cost = new Float64Array((baseCount + 1) * width);
  for (let i = 1; i <= baseCount; i++) cost[i * width] = i * GAP_COST;
  for (let j = 1; j <= targetCount; j++) cost[j] = j * GAP_COST;
  for (let i = 1; i <= baseCount; i++) {
    for (let j = 1; j <= targetCount; j++) {
      cost[i * width + j] = Math.min(
        cost[(i - 1) * width + (j - 1)]! + difference(i - 1, j - 1),
        cost[(i - 1) * width + j]! + GAP_COST,
        cost[i * width + (j - 1)]! + GAP_COST,
      );
    }
  }
  const pairs: AlignedPair[] = [];
  let i = baseCount;
  let j = targetCount;
  while (i > 0 || j > 0) {
    const here = cost[i * width + j]!;
    if (i > 0 && j > 0 && here === cost[(i - 1) * width + (j - 1)]! + difference(i - 1, j - 1)) {
      pairs.push({ baseIndex: i - 1, targetIndex: j - 1 });
      i--;
      j--;
    } else if (i > 0 && here === cost[(i - 1) * width + j]! + GAP_COST) {
      pairs.push({ baseIndex: i - 1, targetIndex: null });
      i--;
    } else {
      pairs.push({ baseIndex: null, targetIndex: j - 1 });
      j--;
    }
  }
  return pairs.reverse();
}

/** Per-slide (or per-page) changes between two ordered unit lists. */
export function compareSequences(
  base: ReadonlyArray<UnitSignature>,
  target: ReadonlyArray<UnitSignature>,
): ReadonlyArray<DeliverableUnitChange> {
  const memo = new Map<number, UnitDifference>();
  const differenceAt = (i: number, j: number) => {
    const key = i * (target.length + 1) + j;
    let found = memo.get(key);
    if (found === undefined) {
      found = unitDifference(base[i]!, target[j]!);
      memo.set(key, found);
    }
    return found;
  };
  return alignUnits(base.length, target.length, (i, j) => differenceAt(i, j).difference).map(
    ({ baseIndex, targetIndex }): DeliverableUnitChange => {
      if (baseIndex === null) {
        return {
          status: "added",
          baseIndex: null,
          targetIndex,
          difference: 1,
          anchor: { kind: "slide", index: targetIndex! },
        };
      }
      if (targetIndex === null) {
        return {
          status: "removed",
          baseIndex,
          targetIndex: null,
          difference: 1,
          anchor: { kind: "slide", index: baseIndex },
        };
      }
      const { difference, region } = differenceAt(baseIndex, targetIndex);
      const changed = difference >= CHANGE_THRESHOLD;
      return {
        status: changed ? "changed" : "unchanged",
        baseIndex,
        targetIndex,
        difference,
        anchor: changed
          ? { kind: "slide", index: targetIndex, ...(region === null ? {} : { region }) }
          : null,
      };
    },
  );
}

export interface TimelineShot {
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

export interface Timeline {
  readonly duration: number;
  readonly shots: ReadonlyArray<TimelineShot>;
  /** Frames sampled at a fixed rate, in time order. */
  readonly samples: ReadonlyArray<{ readonly t: number; readonly data: Uint8Array }>;
}

/** Splits a file of back-to-back grid frames sampled at `fps` into timed samples. */
export function samplesFromBytes(bytes: Uint8Array, fps: number): Timeline["samples"] {
  const size = SIGNATURE_BYTES;
  const samples: Array<{ readonly t: number; readonly data: Uint8Array }> = [];
  for (let offset = 0; offset + size <= bytes.length; offset += size) {
    samples.push({ t: offset / size / fps, data: bytes.subarray(offset, offset + size) });
  }
  return samples;
}

const EDGE_EPSILON = 0.05;

function nearestSample(timeline: Timeline, t: number) {
  const { samples } = timeline;
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (samples[mid]!.t < t) low = mid + 1;
    else high = mid;
  }
  const after = samples[low];
  const before = samples[low - 1];
  if (before !== undefined && (after === undefined || t - before.t <= after.t - t)) return before;
  return after;
}

const unionRegion = (a: DeliverableRegion | null, b: DeliverableRegion | null) => {
  if (a === null) return b;
  if (b === null) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
};

/**
 * Per-shot changes between two videos aligned by timestamp: each target shot is compared with
 * whatever the base shows at the same times. Shots past the other video's end are added or removed.
 */
export function compareTimelines(
  base: Timeline,
  target: Timeline,
): ReadonlyArray<DeliverableUnitChange> {
  const shotAt = (timeline: Timeline, t: number) =>
    timeline.shots.find((shot) => t >= shot.start && t < shot.end) ?? null;
  const changes: DeliverableUnitChange[] = target.shots.map((shot) => {
    if (shot.start >= base.duration - EDGE_EPSILON) {
      return {
        status: "added",
        baseIndex: null,
        targetIndex: shot.index,
        difference: 1,
        anchor: { kind: "time", t: shot.start, tEnd: shot.end },
      };
    }
    const end = Math.min(shot.end, base.duration);
    let inside = target.samples.filter((sample) => sample.t >= shot.start && sample.t < end);
    if (inside.length === 0) {
      const middle = nearestSample(target, (shot.start + end) / 2);
      inside = middle === undefined ? [] : [middle];
    }
    let difference = 0;
    let region: DeliverableRegion | null = null;
    for (const sample of inside) {
      const counterpart = nearestSample(base, sample.t);
      const found =
        counterpart === undefined
          ? { difference: 1, region: null }
          : pixelDifference(counterpart.data, sample.data);
      if (found.difference >= CHANGE_THRESHOLD) region = unionRegion(region, found.region);
      difference = Math.max(difference, found.difference);
    }
    const changed = difference >= CHANGE_THRESHOLD;
    return {
      status: changed ? "changed" : "unchanged",
      baseIndex: shotAt(base, (shot.start + end) / 2)?.index ?? null,
      targetIndex: shot.index,
      difference,
      anchor: changed
        ? { kind: "time", t: shot.start, tEnd: shot.end, ...(region === null ? {} : { region }) }
        : null,
    };
  });
  for (const shot of base.shots) {
    if (shot.start < target.duration - EDGE_EPSILON) continue;
    changes.push({
      status: "removed",
      baseIndex: shot.index,
      targetIndex: null,
      difference: 1,
      anchor: { kind: "time", t: shot.start, tEnd: shot.end },
    });
  }
  return changes;
}
