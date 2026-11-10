import { describe, expect, it } from "vite-plus/test";

import { alignUnits, withMoves } from "./unitAlignment.ts";

/** Units named by a letter; the same letter is the same unit, a prime marks a small edit. */
const cost =
  (base: ReadonlyArray<string>, target: ReadonlyArray<string>) => (i: number, j: number) =>
    base[i] === target[j] ? 0 : base[i]![0] === target[j]![0] ? 0.2 : 1;
const align = (base: ReadonlyArray<string>, target: ReadonlyArray<string>) =>
  withMoves(
    alignUnits(base.length, target.length, cost(base, target)),
    cost(base, target),
    0.5,
  ).map(
    (pair) =>
      `${pair.baseIndex === null ? "-" : base[pair.baseIndex]}>${
        pair.targetIndex === null ? "-" : target[pair.targetIndex]
      }${pair.moved === true ? " moved" : ""}`,
  );

describe("alignUnits", () => {
  it("lines up a unit added in the middle instead of shifting the rest", () => {
    expect(align(["a", "b", "c"], ["a", "x", "b", "c"])).toEqual(["a>a", "->x", "b>b", "c>c"]);
  });

  it("keeps true partners when every unit after the new one changed a little", () => {
    expect(align(["a", "b", "c", "d"], ["a", "x", "b'", "c'", "d'"])).toEqual([
      "a>a",
      "->x",
      "b>b'",
      "c>c'",
      "d>d'",
    ]);
  });

  it("reports one unit dropped and another added, not every unit between them changed", () => {
    expect(align(["a", "b", "c", "d"], ["a", "c", "d", "e"])).toEqual([
      "a>a",
      "b>-",
      "c>c",
      "d>d",
      "->e",
    ]);
  });

  it("pairs a unit replaced in place, so it reads as changed", () => {
    expect(align(["a", "b", "c"], ["a", "x", "c"])).toEqual(["a>a", "b>x", "c>c"]);
  });

  it("handles an empty side", () => {
    expect(align([], ["a", "b"])).toEqual(["->a", "->b"]);
    expect(align(["a"], [])).toEqual(["a>-"]);
  });
});

describe("withMoves", () => {
  it("finds a unit taken out in one place and put in at another", () => {
    expect(align(["a", "b", "c", "d"], ["a", "c", "d", "b"])).toEqual([
      "a>a",
      "c>c",
      "d>d",
      "b>b moved",
    ]);
  });

  it("still finds it when the moved unit was edited on the way", () => {
    expect(align(["a", "b", "c", "d"], ["b'", "a", "c", "d"])).toEqual([
      "b>b' moved",
      "a>a",
      "c>c",
      "d>d",
    ]);
  });

  it("leaves unrelated units as removed and added", () => {
    expect(align(["a", "b", "c"], ["a", "c", "x"])).toEqual(["a>a", "b>-", "c>c", "->x"]);
  });
});
