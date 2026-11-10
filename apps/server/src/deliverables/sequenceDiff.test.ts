// @effect-diagnostics nodeBuiltinImport:off - fixtures are gzipped files read straight from disk.
import * as NodeFS from "node:fs";
import * as NodeZlib from "node:zlib";

import { describe, expect, it } from "vite-plus/test";

import { OUTLINE_GRID, SAME, type UnitSignature } from "./perceptualDiff.ts";
import { alignSequences, compareHashes, sequenceChanges } from "./sequenceDiff.ts";

const CELLS = OUTLINE_GRID * OUTLINE_GRID;

/**
 * The outline of a text slide on a shared template: a light page with `lines` dark rows of text
 * whose cells are set by `seed`, so two seeds are two slides of one layout. `mark` darkens one
 * corner cell, as a page number that changed would.
 */
const slide = (seed: number, mark = 0): UnitSignature => {
  const outline = new Uint8Array(CELLS * 3).fill(235);
  let state = seed * 7919 + 1;
  for (let row = 20; row < 20 + 8 * 6; row += 6) {
    for (let x = 10; x < 80; x++) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      outline.fill(
        40 + (state % 120),
        (row * OUTLINE_GRID + x) * 3,
        (row * OUTLINE_GRID + x) * 3 + 3,
      );
    }
  }
  if (mark > 0) outline.fill(mark, (CELLS - 2) * 3, (CELLS - 1) * 3);
  return { type: "pixels", outline };
};

const statuses = (base: ReadonlyArray<UnitSignature>, target: ReadonlyArray<UnitSignature>) =>
  sequenceChanges(
    alignSequences(base, target).map((pair) => ({
      ...pair,
      difference:
        pair.baseIndex !== null &&
        pair.targetIndex !== null &&
        base[pair.baseIndex] === target[pair.targetIndex]
          ? SAME
          : { difference: 0.01, region: null },
    })),
  ).map((change) => [change.status, change.baseIndex, change.targetIndex]);

/**
 * The outlines the server kept for a real deck rendered by PowerPoint: five text slides on one
 * layout, each with its page number, and the same deck with a sixth slide put in third.
 */
const deck = (name: string): ReadonlyArray<UnitSignature> => {
  const bytes = NodeZlib.gunzipSync(
    NodeFS.readFileSync(new URL(`./fixtures/${name}.outlines.gz`, import.meta.url)),
  );
  const outlines: UnitSignature[] = [];
  for (let offset = 0; offset < bytes.length; offset += CELLS * 3) {
    outlines.push({ type: "pixels", outline: bytes.subarray(offset, offset + CELLS * 3) });
  }
  return outlines;
};
const pairs = (base: ReadonlyArray<UnitSignature>, target: ReadonlyArray<UnitSignature>) =>
  alignSequences(base, target).map(
    (pair) => `${pair.baseIndex ?? "-"}>${pair.targetIndex ?? "-"}${pair.moved ? " moved" : ""}`,
  );

describe("slide sequences of a rendered deck", () => {
  const [before, after] = [deck("deck-v1"), deck("deck-v2")];
  const [title, asks, shipped, next, thanks] = before;
  const pricing = after[2]!;

  it("finds the slide put in the middle and pairs every other slide with itself", () => {
    expect(pairs(before, after)).toEqual(["0>0", "1>1", "->2", "2>3", "3>4", "4>5"]);
    expect(pairs(after, before)).toEqual(["0>0", "1>1", "2>-", "3>2", "4>3", "5>4"]);
  });

  it("reports a deleted slide and a new one of the same layout as removed and added", () => {
    expect(pairs([title!, asks!, shipped!, next!], [title!, shipped!, next!, pricing])).toEqual([
      "0>0",
      "1>-",
      "2>1",
      "3>2",
      "->3",
    ]);
  });

  it("reports a slide put at another place as moved", () => {
    expect(pairs(before, [title!, shipped!, next!, asks!, thanks!])).toEqual([
      "0>0",
      "2>1",
      "3>2",
      "1>3 moved",
      "4>4",
    ]);
  });
});

describe("slide sequences", () => {
  const [a, b, c, d, x] = [slide(1), slide(2), slide(3), slide(4), slide(9)];

  it("reports a slide added in the middle and leaves the slides after it alone", () => {
    expect(statuses([a, b, c, d], [a, b, x, c, d])).toEqual([
      ["unchanged", 0, 0],
      ["unchanged", 1, 1],
      ["added", null, 2],
      ["unchanged", 2, 3],
      ["unchanged", 3, 4],
    ]);
  });

  it("matches slides to themselves when the new slide renumbered every page after it", () => {
    const renumbered = [a, x, slide(2, 60), slide(3, 90), slide(4, 120)];
    expect(statuses([a, slide(2, 30), slide(3, 60), slide(4, 90)], renumbered)).toEqual([
      ["unchanged", 0, 0],
      ["added", null, 1],
      ["changed", 1, 2],
      ["changed", 2, 3],
      ["changed", 3, 4],
    ]);
  });

  it("reports a deleted slide and a similar new one as removed and added", () => {
    expect(statuses([a, b, c, d], [a, c, d, x])).toEqual([
      ["unchanged", 0, 0],
      ["removed", 1, null],
      ["unchanged", 2, 1],
      ["unchanged", 3, 2],
      ["added", null, 3],
    ]);
  });

  it("reports a slide put at another place as moved", () => {
    expect(statuses([a, b, c, d], [a, c, d, b])).toEqual([
      ["unchanged", 0, 0],
      ["unchanged", 2, 1],
      ["unchanged", 3, 2],
      ["moved", 1, 3],
    ]);
  });

  it("keeps where a changed or moved slide changed", () => {
    const region = { x: 0.25, y: 0.5, w: 0.1, h: 0.05 };
    const changes = sequenceChanges([
      { baseIndex: 0, targetIndex: 0, difference: { difference: 0.002, region } },
      { baseIndex: 2, targetIndex: 1, moved: true, difference: SAME },
    ]);
    expect(changes).toEqual([
      {
        status: "changed",
        baseIndex: 0,
        targetIndex: 0,
        difference: 0.002,
        anchor: { kind: "slide", index: 0, region },
      },
      {
        status: "moved",
        baseIndex: 2,
        targetIndex: 1,
        difference: 0,
        anchor: { kind: "slide", index: 1 },
      },
    ]);
  });

  it("compares structural hashes when no pixels were rendered", () => {
    const hash = (value: string): UnitSignature => ({ type: "hash", value });
    const [p, q, r] = [hash("p"), hash("q"), hash("r")];
    expect(compareHashes([p, q], [p, r]).map((change) => change.status)).toEqual([
      "unchanged",
      "changed",
    ]);
    expect(compareHashes([p, q], [p])).toMatchObject([
      { status: "unchanged" },
      { status: "removed", baseIndex: 1, targetIndex: null },
    ]);
    expect(compareHashes([p, q, r], [q, r, p])).toMatchObject([
      { status: "unchanged", baseIndex: 1, targetIndex: 0 },
      { status: "unchanged", baseIndex: 2, targetIndex: 1 },
      { status: "moved", baseIndex: 0, targetIndex: 2, difference: 0 },
    ]);
  });
});
