import type { DeliverableUnitChange } from "@t3tools/contracts";

import {
  outlineDifference,
  SAME,
  type UnitDifference,
  type UnitSignature,
} from "./perceptualDiff.ts";
import { type AlignedPair, alignUnits, type PairingCost, withMoves } from "./unitAlignment.ts";

/**
 * Two outlines differing in this share of their cells are no longer one slide with an edit.
 * Measured on PowerPoint renders: a changed page number moves under 0.0002 of the cells, two
 * text slides of one layout differ in 0.03 to 0.04. Past it a pair costs the same as dropping one
 * slide and adding another, so only its place in the order can pair it.
 */
const SAME_SLIDE_BELOW = 0.02;
/** A slide found at another place is the same slide only while it pairs this cheaply (0-1). */
const MOVED_BELOW = 0.5;

/** What two units cost to pair up while aligning: 0 alike .. 1 a different unit. */
function pairingCost(a: UnitSignature, b: UnitSignature): number {
  if (a.type === "pixels" && b.type === "pixels") {
    return Math.min(1, outlineDifference(a.outline, b.outline) / SAME_SLIDE_BELOW);
  }
  if (a.type === "hash" && b.type === "hash") return a.value === b.value ? 0 : 1;
  return 1;
}

/**
 * Which slide (or page) of one version is which of the other, going by their signatures: added,
 * removed and moved slides are found as such, and every other slide keeps its true partner.
 */
export function alignSequences(
  base: ReadonlyArray<UnitSignature>,
  target: ReadonlyArray<UnitSignature>,
): ReadonlyArray<AlignedPair> {
  const memo = new Map<number, number>();
  const cost: PairingCost = (i, j) => {
    const key = i * (target.length + 1) + j;
    let known = memo.get(key);
    if (known === undefined) {
      known = pairingCost(base[i]!, target[j]!);
      memo.set(key, known);
    }
    return known;
  };
  return withMoves(alignUnits(base.length, target.length, cost), cost, MOVED_BELOW);
}

/** An aligned pair with what changed inside it; the difference of a one-sided pair is unused. */
export interface MeasuredPair extends AlignedPair {
  readonly difference: UnitDifference;
}

/** Per-slide (or per-page) changes, from aligned pairs that have each been measured. */
export function sequenceChanges(
  pairs: ReadonlyArray<MeasuredPair>,
): ReadonlyArray<DeliverableUnitChange> {
  return pairs.map(
    ({ baseIndex, targetIndex, moved, difference: measured }): DeliverableUnitChange => {
      if (baseIndex === null) {
        return {
          status: "added",
          baseIndex: null,
          targetIndex,
          difference: 1,
          anchor: { kind: "slide", index: targetIndex! },
        };
      }
      if (targetIndex === null) {
        return {
          status: "removed",
          baseIndex,
          targetIndex: null,
          difference: 1,
          anchor: { kind: "slide", index: baseIndex },
        };
      }
      const { difference, region } = measured;
      const changed = difference > 0;
      return {
        status: moved === true ? "moved" : changed ? "changed" : "unchanged",
        baseIndex,
        targetIndex,
        difference,
        anchor:
          changed || moved === true
            ? { kind: "slide", index: targetIndex, ...(region === null ? {} : { region }) }
            : null,
      };
    },
  );
}

/** Changes between two unit lists when pixels cannot settle it: a unit matches or it does not. */
export function compareHashes(
  base: ReadonlyArray<UnitSignature>,
  target: ReadonlyArray<UnitSignature>,
): ReadonlyArray<DeliverableUnitChange> {
  return sequenceChanges(
    alignSequences(base, target).map((pair) => ({
      ...pair,
      difference:
        pair.baseIndex !== null &&
        pair.targetIndex !== null &&
        pairingCost(base[pair.baseIndex]!, target[pair.targetIndex]!) === 0
          ? SAME
          : { difference: 1, region: null },
    })),
  );
}
