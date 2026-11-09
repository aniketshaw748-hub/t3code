import { describe, expect, it } from "vite-plus/test";

import {
  anchorCoversChange,
  clampRegion,
  regionIntersectionArea,
  timeRangesOverlap,
  unitsForAnchor,
} from "./deliverableAnchor.ts";

const shots = [
  { index: 0, start: 0, end: 2 },
  { index: 1, start: 2, end: 4 },
  { index: 2, start: 4, end: 6 },
];

describe("clampRegion", () => {
  it("keeps regions inside the unit square", () => {
    expect(clampRegion({ x: -0.2, y: 0.9, w: 0.5, h: 0.5 })).toEqual({
      x: 0,
      y: 0.9,
      w: 0.5,
      h: expect.closeTo(0.1, 9),
    });
    expect(clampRegion({ x: Number.NaN, y: 2, w: 3, h: -1 })).toEqual({ x: 0, y: 1, w: 1, h: 0 });
  });
});

describe("regionIntersectionArea", () => {
  it("measures overlap and treats touching edges as disjoint", () => {
    expect(
      regionIntersectionArea({ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.25, y: 0.25, w: 1, h: 1 }),
    ).toBeCloseTo(0.0625);
    expect(
      regionIntersectionArea({ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }),
    ).toBe(0);
  });
});

describe("timeRangesOverlap", () => {
  it.each([
    [{ start: 1, end: 3 }, { start: 2, end: 4 }, true],
    [{ start: 0, end: 2 }, { start: 2, end: 4 }, false],
    [{ start: 2, end: 2 }, { start: 2, end: 4 }, true],
    [{ start: 4, end: 4 }, { start: 2, end: 4 }, false],
  ] as const)("%o and %o overlap: %s", (a, b, expected) => {
    expect(timeRangesOverlap(a, b)).toBe(expected);
  });
});

describe("unitsForAnchor", () => {
  it("maps slides, time spans and regions to units", () => {
    expect(unitsForAnchor({ kind: "slide", index: 1 }, shots)).toEqual([1]);
    expect(unitsForAnchor({ kind: "slide", index: 9 }, shots)).toEqual([]);
    expect(unitsForAnchor({ kind: "time", t: 3 }, shots)).toEqual([1]);
    expect(unitsForAnchor({ kind: "time", t: 1.5, tEnd: 4.5 }, shots)).toEqual([0, 1, 2]);
    expect(unitsForAnchor({ kind: "region", x: 0, y: 0, w: 1, h: 1 }, shots)).toEqual([0, 1, 2]);
  });
});

describe("anchorCoversChange", () => {
  it("requires the same unit and an overlapping region when both are known", () => {
    const expected = { kind: "time" as const, t: 2.5, region: { x: 0, y: 0, w: 0.5, h: 0.5 } };
    expect(anchorCoversChange(expected, shots, 1, { x: 0.1, y: 0.1, w: 0.1, h: 0.1 })).toBe(true);
    expect(anchorCoversChange(expected, shots, 1, { x: 0.6, y: 0.6, w: 0.1, h: 0.1 })).toBe(false);
    expect(anchorCoversChange(expected, shots, 1, undefined)).toBe(true);
    expect(anchorCoversChange(expected, shots, 2, undefined)).toBe(false);
  });
});
