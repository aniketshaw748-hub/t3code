import type { DeliverableAnchor, DeliverableRegion } from "@t3tools/contracts";

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/** Clamps a region into the unit square, keeping it inside after its origin is clamped. */
export function clampRegion(region: DeliverableRegion): DeliverableRegion {
  const x = clamp01(region.x);
  const y = clamp01(region.y);
  return { x, y, w: Math.min(clamp01(region.w), 1 - x), h: Math.min(clamp01(region.h), 1 - y) };
}

/** Shared area of two regions, as a fraction of the unit square. */
export function regionIntersectionArea(a: DeliverableRegion, b: DeliverableRegion): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return right > left && bottom > top ? (right - left) * (bottom - top) : 0;
}

function regionsOverlap(a: DeliverableRegion, b: DeliverableRegion): boolean {
  return regionIntersectionArea(a, b) > 0;
}

/** A time anchor without an end covers the instant `t`. */
export function timeRangesOverlap(
  a: { readonly start: number; readonly end: number },
  b: { readonly start: number; readonly end: number },
): boolean {
  if (a.start === a.end) return a.start >= b.start && a.start < b.end;
  if (b.start === b.end) return b.start >= a.start && b.start < a.end;
  return a.start < b.end && b.start < a.end;
}

export interface AnchorableUnit {
  readonly index: number;
  readonly start?: number | undefined;
  readonly end?: number | undefined;
}

/** The units an anchor points at: its slide, the shots its time span touches, or every unit. */
export function unitsForAnchor(
  anchor: DeliverableAnchor,
  units: ReadonlyArray<AnchorableUnit>,
): ReadonlyArray<number> {
  switch (anchor.kind) {
    case "slide":
      return units.some((unit) => unit.index === anchor.index) ? [anchor.index] : [];
    case "time": {
      const span = { start: anchor.t, end: anchor.tEnd ?? anchor.t };
      return units
        .filter(
          (unit) =>
            unit.start !== undefined &&
            unit.end !== undefined &&
            timeRangesOverlap(span, { start: unit.start, end: unit.end }),
        )
        .map((unit) => unit.index);
    }
    case "region":
      return units.map((unit) => unit.index);
  }
}

const anchorRegion = (anchor: DeliverableAnchor): DeliverableRegion | undefined =>
  anchor.kind === "region" ? { x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h } : anchor.region;

/**
 * Whether a change found at `unitIndex` (optionally localized to `changeRegion`) lands where
 * `expected` said it would. A missing region on either side matches the whole unit.
 */
export function anchorCoversChange(
  expected: DeliverableAnchor,
  units: ReadonlyArray<AnchorableUnit>,
  unitIndex: number,
  changeRegion: DeliverableRegion | undefined,
): boolean {
  if (!unitsForAnchor(expected, units).includes(unitIndex)) return false;
  const region = anchorRegion(expected);
  return region === undefined || changeRegion === undefined || regionsOverlap(region, changeRegion);
}
