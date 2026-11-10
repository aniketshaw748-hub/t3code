import type { DeliverableRegion } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  containedRect,
  dragRegion,
  fitContain,
  regionGrabAt,
  strokesRegion,
} from "./workGeometry.ts";

const rounded = (region: DeliverableRegion | null) =>
  region === null
    ? null
    : Object.fromEntries(
        Object.entries(region).map(([key, value]) => [key, Math.round(value * 1000) / 1000]),
      );

describe("fitContain", () => {
  it("letterboxes by the tighter side", () => {
    expect(fitContain({ width: 1000, height: 1000 }, 16 / 9)).toEqual({
      width: 1000,
      height: 562.5,
    });
    expect(fitContain({ width: 1600, height: 450 }, 16 / 9)).toEqual({ width: 800, height: 450 });
  });
});

describe("containedRect", () => {
  it("centres wide media between bars above and below, and tall media between side bars", () => {
    expect(containedRect({ width: 400, height: 400 }, 2)).toEqual({
      x: 0,
      y: 100,
      width: 400,
      height: 200,
    });
    // A 9:16 phone video on a stage capped at 420 tall.
    expect(containedRect({ width: 390, height: 420 }, 9 / 16)).toEqual({
      x: 76.875,
      y: 0,
      width: 236.25,
      height: 420,
    });
  });
});

describe("strokesRegion", () => {
  it("boxes every stroke with padding, clamped to the frame", () => {
    const region = strokesRegion(
      [
        [
          { x: 0.2, y: 0.3 },
          { x: 0.4, y: 0.5 },
        ],
        [{ x: 0.99, y: 0.1 }],
      ],
      0.05,
    );
    expect(rounded(region)).toEqual({ x: 0.15, y: 0.05, w: 0.85, h: 0.5 });
    expect(strokesRegion([])).toBeNull();
  });
});

describe("regionGrabAt", () => {
  const region = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
  const reach = { x: 0.05, y: 0.1 };

  it("draws on an empty frame or outside the box", () => {
    expect(regionGrabAt(null, { x: 0.5, y: 0.5 }, reach)).toEqual({ kind: "draw" });
    expect(regionGrabAt(region, { x: 0.9, y: 0.9 }, reach)).toEqual({ kind: "draw" });
  });

  it("takes the nearest corner within reach, just outside the box too", () => {
    expect(regionGrabAt(region, { x: 0.62, y: 0.65 }, reach)).toEqual({
      kind: "resize",
      corner: "se",
    });
    expect(regionGrabAt(region, { x: 0.21, y: 0.22 }, reach)).toEqual({
      kind: "resize",
      corner: "nw",
    });
  });

  it("moves the box from anywhere else inside it", () => {
    expect(regionGrabAt(region, { x: 0.4, y: 0.4 }, reach)).toEqual({ kind: "move" });
  });
});

describe("dragRegion", () => {
  const origin = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };

  it("draws a box whichever way the finger went, and ignores a tap", () => {
    const drag = { grab: { kind: "draw" } as const, origin: null };
    expect(
      rounded(dragRegion({ ...drag, start: { x: 0.7, y: 0.6 }, current: { x: 0.3, y: 0.1 } })),
    ).toEqual({ x: 0.3, y: 0.1, w: 0.4, h: 0.5 });
    expect(
      dragRegion({ ...drag, start: { x: 0.5, y: 0.5 }, current: { x: 0.51, y: 0.5 } }),
    ).toBeNull();
  });

  it("moves the box without changing its size, stopping at the frame's edge", () => {
    const drag = { grab: { kind: "move" } as const, origin, start: { x: 0.4, y: 0.4 } };
    expect(rounded(dragRegion({ ...drag, current: { x: 0.5, y: 0.3 } }))).toEqual({
      x: 0.3,
      y: 0.1,
      w: 0.4,
      h: 0.4,
    });
    expect(rounded(dragRegion({ ...drag, current: { x: 1, y: 0 } }))).toEqual({
      x: 0.6,
      y: 0,
      w: 0.4,
      h: 0.4,
    });
  });

  it("pulls one corner while the opposite one stays put", () => {
    const drag = {
      grab: { kind: "resize", corner: "se" } as const,
      origin,
      start: { x: 0.6, y: 0.6 },
    };
    expect(rounded(dragRegion({ ...drag, current: { x: 0.9, y: 0.7 } }))).toEqual({
      x: 0.2,
      y: 0.2,
      w: 0.7,
      h: 0.5,
    });
    // Pulled past the fixed corner, the box flips instead of inverting.
    expect(rounded(dragRegion({ ...drag, current: { x: 0.1, y: 0.1 } }))).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.1,
      h: 0.1,
    });
  });

  it("keeps a smallest box when a corner is pulled onto its opposite", () => {
    const region = dragRegion({
      grab: { kind: "resize", corner: "se" },
      origin,
      start: { x: 0.6, y: 0.6 },
      current: { x: 0.2, y: 0.2 },
    });
    expect(rounded(region)).toEqual({ x: 0.2, y: 0.2, w: 0.03, h: 0.03 });
  });
});
