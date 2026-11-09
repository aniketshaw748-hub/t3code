import { describe, expect, it } from "vite-plus/test";

import {
  alignUnits,
  compareSequences,
  compareTimelines,
  pixelDifference,
  SIGNATURE_GRID,
  type Timeline,
  type UnitSignature,
} from "./perceptualDiff.ts";

const CELLS = SIGNATURE_GRID * SIGNATURE_GRID;
const flat = (value: number) => new Uint8Array(CELLS * 3).fill(value);
/** A flat frame with a bright square covering grid cells [x0, x1) x [y0, y1). */
const withSquare = (value: number, x0: number, y0: number, x1: number, y1: number) => {
  const data = flat(value);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      data.fill(255, (y * SIGNATURE_GRID + x) * 3, (y * SIGNATURE_GRID + x) * 3 + 3);
  return data;
};
const pixels = (data: Uint8Array): UnitSignature => ({ type: "pixels", data });

describe("pixelDifference", () => {
  it("ignores codec-level noise and localizes real changes", () => {
    const noisy = flat(100);
    noisy[5] = 110;
    expect(pixelDifference(flat(100), noisy)).toEqual({ difference: 0, region: null });

    const changed = pixelDifference(flat(0), withSquare(0, 8, 16, 16, 24));
    expect(changed.difference).toBeCloseTo(64 / CELLS);
    expect(changed.region).toEqual({ x: 0.25, y: 0.5, w: 0.25, h: 0.25 });

    // Red over magenta has the same brightness; grayscale would miss it.
    const magenta = flat(0);
    const red = flat(0);
    for (let i = 0; i < CELLS; i++) {
      magenta.set([191, 0, 192], i * 3);
      red.set(i < 64 ? [255, 0, 0] : [191, 0, 192], i * 3);
    }
    expect(pixelDifference(magenta, red).difference).toBeCloseTo(64 / CELLS);
  });

  it("treats mismatched signatures as completely different", () => {
    expect(pixelDifference(flat(0), new Uint8Array(4)).difference).toBe(1);
  });
});

describe("alignUnits", () => {
  it("lines up an inserted unit instead of shifting the rest", () => {
    const base = [1, 2, 3];
    const target = [1, 9, 2, 3];
    expect(alignUnits(3, 4, (i, j) => (base[i] === target[j] ? 0 : 1))).toEqual([
      { baseIndex: 0, targetIndex: 0 },
      { baseIndex: null, targetIndex: 1 },
      { baseIndex: 1, targetIndex: 2 },
      { baseIndex: 2, targetIndex: 3 },
    ]);
  });
});

describe("compareSequences", () => {
  it("reports changed, unchanged, added and removed slides", () => {
    const a = flat(10);
    const b = flat(120);
    const c = flat(240);
    const changes = compareSequences(
      [pixels(a), pixels(b), pixels(c)],
      [pixels(a), pixels(withSquare(120, 0, 0, 4, 4)), pixels(flat(60)), pixels(c)],
    );
    expect(changes.map((change) => [change.status, change.baseIndex, change.targetIndex])).toEqual([
      ["unchanged", 0, 0],
      ["changed", 1, 1],
      ["added", null, 2],
      ["unchanged", 2, 3],
    ]);
    expect(changes[1]?.anchor).toEqual({
      kind: "slide",
      index: 1,
      region: { x: 0, y: 0, w: 4 / 32, h: 4 / 32 },
    });

    expect(compareSequences([pixels(a), pixels(b)], [pixels(a)])).toMatchObject([
      { status: "unchanged" },
      { status: "removed", baseIndex: 1, targetIndex: null },
    ]);
  });

  it("compares structural hashes when no pixels were rendered", () => {
    const hash = (value: string): UnitSignature => ({ type: "hash", value });
    expect(
      compareSequences([hash("x"), hash("y")], [hash("x"), hash("z")]).map(
        (change) => change.status,
      ),
    ).toEqual(["unchanged", "changed"]);
  });
});

const timeline = (
  duration: number,
  cuts: ReadonlyArray<number>,
  frame: (t: number) => Uint8Array,
): Timeline => {
  const bounds = [0, ...cuts, duration];
  const samples = [];
  for (let t = 0; t < duration; t += 0.5) samples.push({ t, data: frame(t) });
  return {
    duration,
    shots: bounds.slice(0, -1).map((start, index) => ({ index, start, end: bounds[index + 1]! })),
    samples,
  };
};

describe("compareTimelines", () => {
  const original = (t: number) => flat(t < 2 ? 20 : t < 4 ? 120 : 220);

  it("marks only the shot whose frames changed", () => {
    const edited = (t: number) => (t >= 2 && t < 4 ? withSquare(120, 16, 0, 32, 16) : original(t));
    const changes = compareTimelines(timeline(6, [2, 4], original), timeline(6, [2, 4], edited));
    expect(changes.map((change) => change.status)).toEqual(["unchanged", "changed", "unchanged"]);
    expect(changes[1]).toMatchObject({
      baseIndex: 1,
      targetIndex: 1,
      anchor: { kind: "time", t: 2, tEnd: 4, region: { x: 0.5, y: 0, w: 0.5, h: 0.5 } },
    });
  });

  it("reports shots past the other video's end as added or removed", () => {
    const longer = compareTimelines(timeline(4, [2], original), timeline(6, [2, 4], original));
    expect(longer.map((change) => change.status)).toEqual(["unchanged", "unchanged", "added"]);
    const shorter = compareTimelines(timeline(6, [2, 4], original), timeline(4, [2], original));
    expect(shorter.map((change) => change.status)).toEqual(["unchanged", "unchanged", "removed"]);
  });
});
