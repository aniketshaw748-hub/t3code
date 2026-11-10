// @effect-diagnostics nodeBuiltinImport:off - fixtures are gzipped files read straight from disk.
import * as NodeFS from "node:fs";
import * as NodeZlib from "node:zlib";

import { describe, expect, it } from "vite-plus/test";

import { type Raster, VIDEO_GRID } from "./perceptualDiff.ts";
import { compareTimelines, samplesFromBytes, type Timeline } from "./timelineDiff.ts";

const flat = (value: number): Raster => ({
  width: VIDEO_GRID,
  height: VIDEO_GRID,
  data: new Uint8Array(VIDEO_GRID * VIDEO_GRID * 3).fill(value),
});
/** A flat frame with a white block covering [x0, x1) x [y0, y1). */
const withBlock = (base: Raster, x0: number, y0: number, x1: number, y1: number): Raster => {
  const data = base.data.slice();
  for (let y = y0; y < y1; y++) {
    data.fill(255, (y * base.width + x0) * 3, (y * base.width + x1) * 3);
  }
  return { ...base, data };
};

/** A video of back-to-back shots, each `[seconds, frame]`, sampled twice a second from 0. */
const video = (...shots: ReadonlyArray<readonly [seconds: number, frame: Raster]>): Timeline => {
  const bounds: Array<Timeline["shots"][number] & { readonly frame: Raster }> = [];
  let duration = 0;
  for (const [index, [seconds, frame]] of shots.entries()) {
    bounds.push({ index, start: duration, end: duration + seconds, frame });
    duration += seconds;
  }
  const samples: Array<Timeline["samples"][number]> = [];
  for (let step = 0; step / 2 < duration; step++) {
    const t = step / 2;
    samples.push({ t, frame: bounds.find((shot) => t >= shot.start && t < shot.end)!.frame });
  }
  return {
    duration,
    shots: bounds.map(({ index, start, end }) => ({ index, start, end })),
    samples,
  };
};

const [dark, mid, bright, black] = [flat(40), flat(120), flat(220), flat(0)];
const rows = (base: Timeline, target: Timeline) =>
  compareTimelines(base, target).map((change) => [
    change.status,
    change.baseIndex,
    change.targetIndex,
  ]);

/**
 * The frames the server sampled from a real ffmpeg encode, two a second, with the shots its
 * scene detection found: three 2 s shots, and the same cut after one second of black.
 */
const encoded = (name: string, ...cuts: ReadonlyArray<number>): Timeline => {
  const samples = samplesFromBytes(
    NodeZlib.gunzipSync(
      NodeFS.readFileSync(new URL(`./fixtures/${name}.frames.gz`, import.meta.url)),
    ),
    2,
    VIDEO_GRID,
  );
  const bounds = [0, ...cuts, samples.length / 2];
  return {
    duration: samples.length / 2,
    shots: bounds.slice(0, -1).map((start, index) => ({ index, start, end: bounds[index + 1]! })),
    samples,
  };
};

describe("compareTimelines on an encoded video", () => {
  const cut = encoded("cut-v1", 2, 4);
  const delayed = encoded("cut-v2", 1, 3, 5);

  it("reads every shot as unchanged after a second of black is added at the start", () => {
    expect(rows(cut, delayed)).toEqual([
      ["added", null, 0],
      ["unchanged", 0, 1],
      ["unchanged", 1, 2],
      ["unchanged", 2, 3],
    ]);
  });

  it("reports that second as removed when it is taken out again", () => {
    expect(rows(delayed, cut)).toEqual([
      ["unchanged", 1, 0],
      ["unchanged", 2, 1],
      ["unchanged", 3, 2],
      ["removed", 0, null],
    ]);
  });
});

describe("compareTimelines", () => {
  const original = video([2, dark], [2, mid], [2, bright]);

  it("marks only the shot whose frames changed, and where", () => {
    const captioned = withBlock(mid, 64, 0, 128, 64);
    const changes = compareTimelines(original, video([2, dark], [2, captioned], [2, bright]));
    expect(changes.map((change) => change.status)).toEqual(["unchanged", "changed", "unchanged"]);
    // The block is the frame's top-right quarter, framed on its two inner sides.
    expect(changes[1]).toMatchObject({
      baseIndex: 1,
      targetIndex: 1,
      anchor: {
        kind: "time",
        t: 2,
        tEnd: 4,
        region: {
          x: expect.closeTo(0.475),
          y: 0,
          w: expect.closeTo(0.525),
          h: expect.closeTo(0.525),
        },
      },
    });
  });

  it("reads every shot as unchanged after a second is added at the start", () => {
    expect(rows(original, video([1, black], [2, dark], [2, mid], [2, bright]))).toEqual([
      ["added", null, 0],
      ["unchanged", 0, 1],
      ["unchanged", 1, 2],
      ["unchanged", 2, 3],
    ]);
  });

  it("reports a shot cut from the middle as removed and keeps the rest paired", () => {
    expect(rows(original, video([2, dark], [2, bright]))).toEqual([
      ["unchanged", 0, 0],
      ["unchanged", 2, 1],
      ["removed", 1, null],
    ]);
  });

  it("reports a shot put at another place as moved", () => {
    expect(rows(original, video([2, mid], [2, dark], [2, bright]))).toEqual([
      ["moved", 1, 0],
      ["unchanged", 0, 1],
      ["unchanged", 2, 2],
    ]);
  });

  it("reports a shot replaced by other footage as that shot changed", () => {
    expect(rows(original, video([2, dark], [2, black], [2, bright]))).toEqual([
      ["unchanged", 0, 0],
      ["changed", 1, 1],
      ["unchanged", 2, 2],
    ]);
  });

  it("marks a shot that was held longer or trimmed as changed", () => {
    expect(rows(original, video([2, dark], [4, mid], [2, bright]))).toEqual([
      ["unchanged", 0, 0],
      ["changed", 1, 1],
      ["unchanged", 2, 2],
    ]);
    expect(rows(video([2, dark], [4, mid], [2, bright]), original)).toEqual([
      ["unchanged", 0, 0],
      ["changed", 1, 1],
      ["unchanged", 2, 2],
    ]);
  });

  it("forgives the sampling grid falling differently on shots that shifted", () => {
    // 2.2 s shots hold four or five samples depending on where the half-second grid falls.
    const uneven = video([2.2, dark], [2.2, mid], [2.2, bright]);
    const shifted = video([0.7, black], [2.2, dark], [2.2, mid], [2.2, bright]);
    expect(rows(uneven, shifted)).toEqual([
      ["added", null, 0],
      ["unchanged", 0, 1],
      ["unchanged", 1, 2],
      ["unchanged", 2, 3],
    ]);
  });

  it("reports shots past the other video's end as added or removed", () => {
    const shorter = video([2, dark], [2, mid]);
    expect(rows(shorter, original)).toEqual([
      ["unchanged", 0, 0],
      ["unchanged", 1, 1],
      ["added", null, 2],
    ]);
    expect(rows(original, shorter)).toEqual([
      ["unchanged", 0, 0],
      ["unchanged", 1, 1],
      ["removed", 2, null],
    ]);
  });
});
