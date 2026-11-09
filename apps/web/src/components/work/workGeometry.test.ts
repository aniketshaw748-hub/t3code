import { describe, expect, it } from "vite-plus/test";

import { fitContain, strokesRegion } from "./workGeometry";

describe("fitContain", () => {
  it("letterboxes by the tighter side", () => {
    expect(fitContain({ width: 1000, height: 1000 }, 16 / 9)).toEqual({
      width: 1000,
      height: 562.5,
    });
    expect(fitContain({ width: 1600, height: 450 }, 16 / 9)).toEqual({ width: 800, height: 450 });
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
    const rounded = Object.fromEntries(
      Object.entries(region ?? {}).map(([key, value]) => [key, Math.round(value * 1000) / 1000]),
    );
    expect(rounded).toEqual({ x: 0.15, y: 0.05, w: 0.85, h: 0.5 });
    expect(strokesRegion([])).toBeNull();
  });
});
