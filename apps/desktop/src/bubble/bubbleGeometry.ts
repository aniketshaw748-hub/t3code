import {
  DESKTOP_BUBBLE_DISC_SIZE,
  type DesktopBubbleEdge,
  type DesktopBubbleSize,
} from "@t3tools/contracts";

export interface BubblePoint {
  readonly x: number;
  readonly y: number;
}

export interface BubbleRect extends BubblePoint {
  readonly width: number;
  readonly height: number;
}

export interface BubbleWindowPlacement {
  readonly bounds: BubbleRect;
  readonly horizontal: DesktopBubbleEdge;
  readonly vertical: DesktopBubbleEdge;
}

/** Gap kept between a snapped disc and the screen edge. */
export const BUBBLE_EDGE_MARGIN = 12;

const DISC = DESKTOP_BUBBLE_DISC_SIZE;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * The window around the disc. The disc stays where it is on screen and the window grows toward the
 * middle of the work area, so a panel opens away from the edge the disc is snapped to.
 */
export function resolveBubbleWindowPlacement(input: {
  readonly disc: BubblePoint;
  readonly size: DesktopBubbleSize;
  readonly workArea: BubbleRect;
}): BubbleWindowPlacement {
  const { disc, size, workArea } = input;
  const horizontal: DesktopBubbleEdge =
    disc.x + DISC / 2 > workArea.x + workArea.width / 2 ? "end" : "start";
  const vertical: DesktopBubbleEdge =
    disc.y + DISC / 2 > workArea.y + workArea.height / 2 ? "end" : "start";
  const width = Math.round(
    clamp(
      size.width,
      DISC,
      horizontal === "end" ? disc.x + DISC - workArea.x : workArea.x + workArea.width - disc.x,
    ),
  );
  const height = Math.round(
    clamp(
      size.height,
      DISC,
      vertical === "end" ? disc.y + DISC - workArea.y : workArea.y + workArea.height - disc.y,
    ),
  );
  return {
    bounds: {
      x: Math.round(horizontal === "end" ? disc.x + DISC - width : disc.x),
      y: Math.round(vertical === "end" ? disc.y + DISC - height : disc.y),
      width,
      height,
    },
    horizontal,
    vertical,
  };
}

/** Moves the disc to the nearer side edge of the work area, keeping its height on screen. */
export function snapBubbleToEdge(disc: BubblePoint, workArea: BubbleRect): BubblePoint {
  const left = workArea.x + BUBBLE_EDGE_MARGIN;
  const right = workArea.x + workArea.width - DISC - BUBBLE_EDGE_MARGIN;
  return {
    x: Math.round(disc.x + DISC / 2 < workArea.x + workArea.width / 2 ? left : right),
    y: Math.round(
      clamp(
        disc.y,
        workArea.y + BUBBLE_EDGE_MARGIN,
        workArea.y + workArea.height - DISC - BUBBLE_EDGE_MARGIN,
      ),
    ),
  };
}

/** Right edge, a little below the middle, where it covers the least. */
export function defaultBubblePosition(workArea: BubbleRect): BubblePoint {
  return snapBubbleToEdge(
    { x: workArea.x + workArea.width, y: workArea.y + Math.round(workArea.height * 0.6) },
    workArea,
  );
}

function rectContains(rect: BubbleRect, point: BubblePoint): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x < rect.x + rect.width &&
    point.y < rect.y + rect.height
  );
}

/** A saved position, re-snapped to whichever display now holds it; null when none does. */
export function restoreBubblePosition(
  saved: BubblePoint | null,
  workAreas: ReadonlyArray<BubbleRect>,
): BubblePoint | null {
  if (saved === null) return null;
  const center = { x: saved.x + DISC / 2, y: saved.y + DISC / 2 };
  const workArea = workAreas.find((area) => rectContains(area, center));
  return workArea === undefined ? null : snapBubbleToEdge(saved, workArea);
}

/** Eased intermediate positions for a snap, ending exactly on `to`. */
export function bubbleSnapPath(from: BubblePoint, to: BubblePoint, steps: number): BubblePoint[] {
  const path: BubblePoint[] = [];
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const eased = 1 - (1 - t) ** 3;
    path.push({
      x: Math.round(from.x + (to.x - from.x) * eased),
      y: Math.round(from.y + (to.y - from.y) * eased),
    });
  }
  return path;
}
