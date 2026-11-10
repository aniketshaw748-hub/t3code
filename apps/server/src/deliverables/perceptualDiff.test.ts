// @effect-diagnostics nodeBuiltinImport:off - fixtures are gzipped files read straight from disk.
import * as NodeFS from "node:fs";
import * as NodeZlib from "node:zlib";

import { describe, expect, it } from "vite-plus/test";

import { parsePpm } from "./mediaParsing.ts";
import {
  DISPLAY_TOLERANCE,
  frameRegion,
  OUTLINE_GRID,
  type Raster,
  rasterDifference,
  SAME,
  type UnitSignature,
  unmeasuredDifference,
  VIDEO_TOLERANCE,
} from "./perceptualDiff.ts";

/**
 * Crops of real PowerPoint slides (rendered at 1280 wide and read back from the display JPEG, as
 * the server does) and 128-grid frames of real ffmpeg encodes. Each is a gzipped binary PPM.
 */
const fixture = (name: string): Raster => {
  const raster = parsePpm(
    NodeZlib.gunzipSync(NodeFS.readFileSync(new URL(`./fixtures/${name}.ppm.gz`, import.meta.url))),
  );
  if (raster === null) throw new Error(`Fixture ${name} is not a PPM.`);
  return raster;
};

const flat = (width: number, height: number, value: number): Raster => ({
  width,
  height,
  data: new Uint8Array(width * height * 3).fill(value),
});
/** A flat raster with a white block covering [x0, x1) x [y0, y1). */
const withBlock = (base: Raster, x0: number, y0: number, x1: number, y1: number): Raster => {
  const data = base.data.slice();
  for (let y = y0; y < y1; y++) {
    data.fill(255, (y * base.width + x0) * 3, (y * base.width + x1) * 3);
  }
  return { ...base, data };
};
/** The region in whole pixels of a raster `width` x `height`. */
const box = (region: { x: number; y: number; w: number; h: number } | null, of: Raster) =>
  region === null
    ? null
    : {
        left: Math.round(region.x * of.width),
        top: Math.round(region.y * of.height),
        right: Math.round((region.x + region.w) * of.width),
        bottom: Math.round((region.y + region.h) * of.height),
      };

describe("rasterDifference on rendered slides", () => {
  it("catches one word added to a subtitle and boxes just that word", () => {
    const before = fixture("title-draft");
    const found = rasterDifference(before, fixture("title-draft-two"), DISPLAY_TOLERANCE);
    // "Draft" became "Draft two": the line re-centred, so the box frames the subtitle
    // (162..320 x 153..184 of the crop) and stays clear of the title above it.
    expect(found.difference).toBeGreaterThan(0.01);
    expect(found.difference).toBeLessThan(0.03);
    const around = box(found.region, before)!;
    expect(around.top).toBeGreaterThan(140);
    expect(around.bottom).toBeLessThanOrEqual(190);
    expect(around.left).toBeGreaterThan(140);
    expect(around.right).toBeLessThan(340);
  });

  it("catches one changed digit in 12pt table text", () => {
    const before = fixture("table");
    const found = rasterDifference(before, fixture("table-digit"), DISPLAY_TOLERANCE);
    // "41%" became "47%": a few dozen pixels in one table cell, 8 wide and 10 tall.
    expect(found.difference).toBeGreaterThan(0);
    expect(found.difference).toBeLessThan(0.001);
    expect(found.region).toEqual(frameRegion({ x: 298 / 480, y: 70 / 200, w: 8 / 480, h: 0.05 }));
  });

  it("reads the same slide moved by one pixel as unchanged", () => {
    expect(rasterDifference(fixture("table"), fixture("table-shifted"), DISPLAY_TOLERANCE)).toBe(
      SAME,
    );
  });

  it("reads an identical render, and a lossy copy of it, as unchanged", () => {
    const slide = fixture("title-draft");
    expect(rasterDifference(slide, fixture("title-draft"), DISPLAY_TOLERANCE)).toBe(SAME);
    // The same crop decoded from the lossless PNG instead of the display JPEG.
    expect(rasterDifference(slide, fixture("title-draft-lossless"), DISPLAY_TOLERANCE)).toBe(SAME);
  });

  it("catches a fill colour nudged by eight steps in one channel", () => {
    const before = fixture("box");
    const found = rasterDifference(before, fixture("box-tinted"), DISPLAY_TOLERANCE);
    expect(found.difference).toBeGreaterThan(0.4);
    // The shape sits at 35..324 x 30..185 of the crop.
    const around = box(found.region, before)!;
    expect(around.left).toBeLessThan(45);
    expect(around.right).toBeGreaterThan(315);
    expect(around.right).toBeLessThan(340);
  });

  it("catches a moved shape and a swapped picture", () => {
    const moved = rasterDifference(fixture("box"), fixture("box-moved"), DISPLAY_TOLERANCE);
    // Only the two edges that moved count, not the fill between them.
    expect(moved.difference).toBeGreaterThan(0.02);
    expect(moved.difference).toBeLessThan(0.1);
    const swapped = rasterDifference(
      fixture("picture"),
      fixture("picture-swapped"),
      DISPLAY_TOLERANCE,
    );
    expect(swapped.difference).toBeGreaterThan(0.5);
  });

  it("treats a different frame size as completely different", () => {
    expect(
      rasterDifference(flat(40, 30, 200), flat(30, 40, 200), DISPLAY_TOLERANCE).difference,
    ).toBe(1);
  });

  it("ignores a lone pixel and keeps a small mark", () => {
    const paper = flat(64, 48, 240);
    expect(rasterDifference(paper, withBlock(paper, 10, 10, 11, 11), DISPLAY_TOLERANCE)).toBe(SAME);
    const dot = rasterDifference(paper, withBlock(paper, 10, 10, 13, 13), DISPLAY_TOLERANCE);
    expect(dot.region).toEqual(frameRegion({ x: 10 / 64, y: 10 / 48, w: 3 / 64, h: 3 / 48 }));
  });
});

describe("rasterDifference on video frames", () => {
  it("reads a re-encode of the same frame as unchanged", () => {
    // The same frame after libx264 at crf 30, off a crf 18 original.
    expect(rasterDifference(fixture("frame"), fixture("frame-reencoded"), VIDEO_TOLERANCE)).toBe(
      SAME,
    );
  });

  it("catches a changed caption word and a light grade", () => {
    const frame = fixture("frame");
    const caption = rasterDifference(frame, fixture("frame-caption-edit"), VIDEO_TOLERANCE);
    // "Friday" became "Monday" in a caption across the lower third.
    expect(caption.difference).toBeGreaterThan(0.005);
    expect(caption.difference).toBeLessThan(0.02);
    expect(caption.region!.y).toBeGreaterThan(0.75);
    expect(caption.region!.y + caption.region!.h).toBeLessThan(0.9);
    // Brightness up by 3%: no pixel moves far, the whole frame moves a little.
    const graded = rasterDifference(frame, fixture("frame-graded"), VIDEO_TOLERANCE);
    expect(graded.difference).toBeGreaterThan(0.3);
  });
});

describe("frameRegion", () => {
  it("leaves room around a change and stays inside the frame", () => {
    const framed = frameRegion({ x: 0.4, y: 0.5, w: 0.1, h: 0.02 });
    expect(framed.x).toBeCloseTo(0.375);
    expect(framed.y).toBeCloseTo(0.475);
    expect(framed.w).toBeCloseTo(0.15);
    expect(framed.h).toBeCloseTo(0.07);
    expect(frameRegion({ x: 0, y: 0.99, w: 1, h: 0.01 })).toEqual({
      x: 0,
      y: 0.965,
      w: 1,
      h: expect.closeTo(0.035),
    });
  });
});

const outline = (value: number): UnitSignature => ({
  type: "pixels",
  outline: new Uint8Array(OUTLINE_GRID * OUTLINE_GRID * 3).fill(value),
});

describe("unmeasuredDifference", () => {
  it("never reports nothing for images that differ but could not be measured", () => {
    expect(unmeasuredDifference(outline(10), outline(10))).toEqual({
      difference: 1 / (OUTLINE_GRID * OUTLINE_GRID),
      region: null,
    });
    expect(unmeasuredDifference(outline(10), outline(200)).difference).toBe(1);
  });
});
