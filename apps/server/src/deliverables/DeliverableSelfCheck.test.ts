import {
  type DeliverableComparison,
  DeliverableId,
  type DeliverableUnitChange,
  DeliverableVersionId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { changedWhereRequested } from "./DeliverableSelfCheck.ts";

const shots = [
  { index: 0, start: 0, end: 2 },
  { index: 1, start: 2, end: 4 },
  { index: 2, start: 4, end: 6 },
];

const comparison = (units: ReadonlyArray<DeliverableUnitChange>): DeliverableComparison => ({
  deliverableId: DeliverableId.make("d"),
  kind: "video",
  baseVersionId: DeliverableVersionId.make("v1"),
  targetVersionId: DeliverableVersionId.make("v2"),
  method: "perceptual",
  units,
  counts: { changed: 0, unchanged: 0, added: 0, removed: 0 },
  summary: null,
  headline: "",
});

const unchanged = (index: number): DeliverableUnitChange => ({
  status: "unchanged",
  baseIndex: index,
  targetIndex: index,
  difference: 0,
  anchor: null,
});
const changed = (index: number): DeliverableUnitChange => ({
  status: "changed",
  baseIndex: index,
  targetIndex: index,
  difference: 0.2,
  anchor: {
    kind: "time",
    t: index * 2,
    tEnd: index * 2 + 2,
    region: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
  },
});

describe("changedWhereRequested", () => {
  it("passes when the only change is where the request pointed", () => {
    expect(
      changedWhereRequested.run({
        expectedChanges: [{ kind: "time", t: 3 }],
        comparison: comparison([unchanged(0), changed(1), unchanged(2)]),
        units: shots,
      }).status,
    ).toBe("passed");
  });

  it("fails when the requested place is unchanged or something else changed", () => {
    const verdict = changedWhereRequested.run({
      expectedChanges: [{ kind: "time", t: 1 }],
      comparison: comparison([unchanged(0), changed(1), unchanged(2)]),
      units: shots,
    });
    expect(verdict).toEqual({
      status: "failed",
      findings: [
        "Expected a change at 0:01, but it looks the same.",
        "0:02–0:04 changed, outside the request.",
      ],
    });
  });

  it("checks the region inside the unit when the request names one", () => {
    const verdict = changedWhereRequested.run({
      expectedChanges: [{ kind: "time", t: 3, region: { x: 0, y: 0.6, w: 0.3, h: 0.3 } }],
      comparison: comparison([unchanged(0), changed(1), unchanged(2)]),
      units: shots,
    });
    expect(verdict.status).toBe("failed");
  });

  it("skips without expectations or a previous version", () => {
    expect(
      changedWhereRequested.run({ expectedChanges: [], comparison: null, units: shots }).status,
    ).toBe("skipped");
    expect(
      changedWhereRequested.run({
        expectedChanges: [{ kind: "slide", index: 0 }],
        comparison: null,
        units: shots,
      }).status,
    ).toBe("skipped");
  });
});
