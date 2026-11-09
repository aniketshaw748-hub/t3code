import type { DeliverableRegion } from "@t3tools/contracts";

/** The largest box of `aspect` (width / height) that fits inside the container. */
export function fitContain(
  container: { readonly width: number; readonly height: number },
  aspect: number,
): { readonly width: number; readonly height: number } {
  if (!(aspect > 0) || container.width <= 0 || container.height <= 0) {
    return { width: Math.max(0, container.width), height: Math.max(0, container.height) };
  }
  const width = Math.min(container.width, container.height * aspect);
  return { width, height: width / aspect };
}

export interface StrokePoint {
  readonly x: number;
  readonly y: number;
}

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
