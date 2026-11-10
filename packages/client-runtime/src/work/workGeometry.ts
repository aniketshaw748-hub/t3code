import type { DeliverableRegion } from "@t3tools/contracts";

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The largest box of `aspect` (width / height) that fits inside the container. */
export function fitContain(container: Size, aspect: number): Size {
  if (!(aspect > 0) || container.width <= 0 || container.height <= 0) {
    return { width: Math.max(0, container.width), height: Math.max(0, container.height) };
  }
  const width = Math.min(container.width, container.height * aspect);
  return { width, height: width / aspect };
}

export interface Rect extends Size {
  readonly x: number;
  readonly y: number;
}

/** Where letterboxed media of `aspect` sits in its container: the contained box, centred. */
export function containedRect(container: Size, aspect: number): Rect {
  const box = fitContain(container, aspect);
  return {
    x: (container.width - box.width) / 2,
    y: (container.height - box.height) / 2,
    ...box,
  };
}

/** A position on a frame or slide, 0..1 from its top left. */
export interface StrokePoint {
  readonly x: number;
  readonly y: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The normalized box around everything drawn, padded so a circle drawn around a logo keeps
 * the logo inside, or null when nothing was drawn.
 */
export function strokesRegion(
  strokes: ReadonlyArray<ReadonlyArray<StrokePoint>>,
  padding = 0.02,
): DeliverableRegion | null {
  const points = strokes.flat();
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.max(0, Math.min(...xs) - padding);
  const top = Math.max(0, Math.min(...ys) - padding);
  const right = Math.min(1, Math.max(...xs) + padding);
  const bottom = Math.min(1, Math.max(...ys) + padding);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** The box between two opposite corners, whichever way it was dragged. */
function regionFromCorners(a: StrokePoint, b: StrokePoint): DeliverableRegion {
  const left = clamp01(Math.min(a.x, b.x));
  const top = clamp01(Math.min(a.y, b.y));
  return {
    x: left,
    y: top,
    w: clamp01(Math.max(a.x, b.x)) - left,
    h: clamp01(Math.max(a.y, b.y)) - top,
  };
}

export type RegionCorner = "nw" | "ne" | "sw" | "se";

/** What a touch on the frame takes hold of: a corner of the box, the box, or empty frame. */
export type RegionGrab =
  | { readonly kind: "draw" }
  | { readonly kind: "move" }
  | { readonly kind: "resize"; readonly corner: RegionCorner };

const CORNERS: ReadonlyArray<RegionCorner> = ["nw", "ne", "sw", "se"];

const cornerPoint = (region: DeliverableRegion, corner: RegionCorner): StrokePoint => ({
  x: corner === "nw" || corner === "sw" ? region.x : region.x + region.w,
  y: corner === "nw" || corner === "ne" ? region.y : region.y + region.h,
});

const OPPOSITE: Record<RegionCorner, RegionCorner> = { nw: "se", ne: "sw", sw: "ne", se: "nw" };

/**
 * What a touch at `point` grabs. `reach` is how far from a corner still counts, as a fraction
 * of the frame's width and height, so a finger-sized target stays the same size on any frame.
 */
export function regionGrabAt(
  region: DeliverableRegion | null,
  point: StrokePoint,
  reach: StrokePoint,
): RegionGrab {
  if (region === null) return { kind: "draw" };
  const nearest = CORNERS.map((corner) => {
    const at = cornerPoint(region, corner);
    const dx = reach.x > 0 ? (point.x - at.x) / reach.x : Number.POSITIVE_INFINITY;
    const dy = reach.y > 0 ? (point.y - at.y) / reach.y : Number.POSITIVE_INFINITY;
    return { corner, distance: Math.hypot(dx, dy) };
  }).reduce((best, candidate) => (candidate.distance < best.distance ? candidate : best));
  if (nearest.distance <= 1) return { kind: "resize", corner: nearest.corner };
  const inside =
    point.x >= region.x &&
    point.x <= region.x + region.w &&
    point.y >= region.y &&
    point.y <= region.y + region.h;
  return inside ? { kind: "move" } : { kind: "draw" };
}

/** Smaller than this in both directions is a tap, not a box. */
const MIN_REGION_SIZE = 0.03;

/**
 * The box after a drag from `start` to `current`: a new box, the old one moved, or the old one
 * with a corner pulled. Null when a new box would be too small to mean anything.
 */
export function dragRegion(input: {
  readonly grab: RegionGrab;
  readonly origin: DeliverableRegion | null;
  readonly start: StrokePoint;
  readonly current: StrokePoint;
}): DeliverableRegion | null {
  const { grab, origin, start, current } = input;
  if (grab.kind === "draw" || origin === null) {
    const drawn = regionFromCorners(start, current);
    return drawn.w < MIN_REGION_SIZE && drawn.h < MIN_REGION_SIZE ? null : drawn;
  }
  if (grab.kind === "move") {
    return {
      ...origin,
      x: Math.min(1 - origin.w, Math.max(0, origin.x + current.x - start.x)),
      y: Math.min(1 - origin.h, Math.max(0, origin.y + current.y - start.y)),
    };
  }
  const fixed = cornerPoint(origin, OPPOSITE[grab.corner]);
  const pulled = regionFromCorners(fixed, current);
  // A corner pulled onto its opposite keeps the smallest box instead of vanishing.
  const w = Math.max(pulled.w, MIN_REGION_SIZE);
  const h = Math.max(pulled.h, MIN_REGION_SIZE);
  return {
    x: Math.max(0, Math.min(1 - w, current.x < fixed.x ? fixed.x - w : fixed.x)),
    y: Math.max(0, Math.min(1 - h, current.y < fixed.y ? fixed.y - h : fixed.y)),
    w,
    h,
  };
}
