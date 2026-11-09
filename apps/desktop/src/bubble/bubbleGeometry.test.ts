import { DESKTOP_BUBBLE_DISC_SIZE as DISC } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  BUBBLE_EDGE_MARGIN,
  bubbleSnapPath,
  defaultBubblePosition,
  resolveBubbleWindowPlacement,
  restoreBubblePosition,
  snapBubbleToEdge,
} from "./bubbleGeometry.ts";

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const secondDisplay = { x: 1920, y: 0, width: 1280, height: 1000 };

describe("resolveBubbleWindowPlacement", () => {
  it("grows toward the middle from a disc on the right edge, low on screen", () => {
    const disc = { x: 1920 - DISC - BUBBLE_EDGE_MARGIN, y: 700 };
    expect(
      resolveBubbleWindowPlacement({ disc, size: { width: 320, height: 300 }, workArea }),
    ).toEqual({
      bounds: { x: disc.x + DISC - 320, y: disc.y + DISC - 300, width: 320, height: 300 },
      horizontal: "end",
      vertical: "end",
    });
  });

  it("keeps the disc at the window's top-left from the top-left of the screen", () => {
    const disc = { x: BUBBLE_EDGE_MARGIN, y: 40 };
    expect(
      resolveBubbleWindowPlacement({ disc, size: { width: 320, height: 300 }, workArea }),
    ).toEqual({
      bounds: { x: disc.x, y: disc.y, width: 320, height: 300 },
      horizontal: "start",
      vertical: "start",
    });
  });

  it("clamps a panel taller than the space below the disc", () => {
    const disc = { x: BUBBLE_EDGE_MARGIN, y: 400 };
    const placement = resolveBubbleWindowPlacement({
      disc,
      size: { width: 320, height: 900 },
      workArea,
    });
    expect(placement.vertical).toBe("start");
    expect(placement.bounds.height).toBe(workArea.height - disc.y);
  });

  it("never shrinks the window below the disc", () => {
    const disc = { x: 0, y: 0 };
    const placement = resolveBubbleWindowPlacement({
      disc,
      size: { width: DISC, height: DISC },
      workArea,
    });
    expect(placement.bounds).toEqual({ x: 0, y: 0, width: DISC, height: DISC });
  });
});

describe("snapBubbleToEdge", () => {
  it("snaps to the nearer side and keeps the disc inside the work area", () => {
    expect(snapBubbleToEdge({ x: 300, y: -50 }, workArea)).toEqual({
      x: BUBBLE_EDGE_MARGIN,
      y: BUBBLE_EDGE_MARGIN,
    });
    expect(snapBubbleToEdge({ x: 1500, y: 2000 }, workArea)).toEqual({
      x: 1920 - DISC - BUBBLE_EDGE_MARGIN,
      y: 1040 - DISC - BUBBLE_EDGE_MARGIN,
    });
  });

  it("snaps within a display that is not at the origin", () => {
    expect(snapBubbleToEdge({ x: 2000, y: 300 }, secondDisplay)).toEqual({
      x: 1920 + BUBBLE_EDGE_MARGIN,
      y: 300,
    });
  });
});

describe("restoreBubblePosition", () => {
  it("re-snaps a saved position on the display that still holds it", () => {
    expect(restoreBubblePosition({ x: 2600, y: 400 }, [workArea, secondDisplay])).toEqual({
      x: 1920 + 1280 - DISC - BUBBLE_EDGE_MARGIN,
      y: 400,
    });
  });

  it("drops a position whose display is gone", () => {
    expect(restoreBubblePosition({ x: 2600, y: 400 }, [workArea])).toBeNull();
    expect(restoreBubblePosition(null, [workArea])).toBeNull();
  });

  it("defaults to the right edge", () => {
    expect(defaultBubblePosition(workArea).x).toBe(1920 - DISC - BUBBLE_EDGE_MARGIN);
  });
});

describe("bubbleSnapPath", () => {
  it("eases out and ends on the target", () => {
    const path = bubbleSnapPath({ x: 0, y: 0 }, { x: 100, y: 10 }, 4);
    expect(path).toHaveLength(4);
    expect(path.at(-1)).toEqual({ x: 100, y: 10 });
    const firstStep = path[0]?.x ?? 0;
    expect(firstStep).toBeGreaterThan(25);
  });
});
