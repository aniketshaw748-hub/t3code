import { DeliverableVersionId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildVersionGraph,
  type GraphVersion,
  nextVersionOrdinal,
  redoTarget,
  undoTarget,
} from "./deliverableVersionGraph.ts";

const id = (ordinal: number) => DeliverableVersionId.make(`v${ordinal}`);
const version = (ordinal: number, parent: number | null): GraphVersion => ({
  id: id(ordinal),
  ordinal,
  parentVersionId: parent === null ? null : id(parent),
});

// V1 -> V2 -> V3, then undo to V2 and a new edit forks V4 from it.
const forked = [version(1, null), version(2, 1), version(3, 2), version(4, 2)];

describe("versionGraph", () => {
  it("numbers versions after the highest ordinal", () => {
    expect(nextVersionOrdinal([])).toBe(1);
    expect(nextVersionOrdinal(forked)).toBe(5);
  });

  it("undoes to the parent and redoes to the newest child", () => {
    expect(undoTarget(forked, id(4))).toBe(id(2));
    expect(undoTarget(forked, id(1))).toBeNull();
    expect(redoTarget(forked, id(2))).toBe(id(4));
    expect(redoTarget(forked, id(3))).toBeNull();
    expect(redoTarget(forked, null)).toBeNull();
  });

  it("marks the line through the current version and leaves the old branch as an alternate", () => {
    const graph = buildVersionGraph(forked, id(2));
    expect(
      graph.map((node) => [node.ordinal, node.isCurrent, node.onCurrentLine, node.alternate]),
    ).toEqual([
      [1, false, true, false],
      [2, true, true, false],
      [3, false, false, true],
      [4, false, true, false],
    ]);
    expect(graph[1]?.childVersionIds).toEqual([id(3), id(4)]);
  });

  it("puts a restored alternate back on the current line", () => {
    const graph = buildVersionGraph(forked, id(3));
    expect(graph.filter((node) => node.alternate).map((node) => node.ordinal)).toEqual([4]);
  });
});
