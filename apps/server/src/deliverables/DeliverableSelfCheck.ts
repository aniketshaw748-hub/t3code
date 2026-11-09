import type {
  DeliverableAnchor,
  DeliverableComparison,
  DeliverableSelfCheckResult,
  DeliverableUnitChange,
} from "@t3tools/contracts";
import { type AnchorableUnit, anchorCoversChange } from "@t3tools/shared/deliverableAnchor";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface SelfCheckInput {
  /** Where the request said the change should land. */
  readonly expectedChanges: ReadonlyArray<DeliverableAnchor>;
  /** The new version against the one it was made from, or null for a first version. */
  readonly comparison: DeliverableComparison | null;
  /** The new version's units, for mapping anchors to slides or shots. */
  readonly units: ReadonlyArray<AnchorableUnit>;
}

export interface SelfCheckVerdict {
  readonly status: DeliverableSelfCheckResult["status"];
  readonly findings: ReadonlyArray<string>;
}

/** One post-turn check of a rendered version against the request that produced it. */
export interface SelfCheck {
  readonly name: string;
  readonly run: (input: SelfCheckInput) => SelfCheckVerdict;
}

/**
 * Runs after a version's renditions are ready. Checks are pure over the comparison, so a check
 * that needs a model or a second render belongs behind its own service, not here.
 */
export class DeliverableSelfCheck extends Context.Service<
  DeliverableSelfCheck,
  { readonly run: (input: SelfCheckInput) => Effect.Effect<DeliverableSelfCheckResult> }
>()("t3/deliverables/DeliverableSelfCheck") {}

const describeAnchor = (anchor: DeliverableAnchor) => {
  const clock = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  switch (anchor.kind) {
    case "slide":
      return `slide ${anchor.index + 1}`;
    case "time":
      return anchor.tEnd === undefined
        ? `${clock(anchor.t)}`
        : `${clock(anchor.t)}–${clock(anchor.tEnd)}`;
    case "region":
      return "the marked region";
  }
};

const changeRegion = (change: DeliverableUnitChange) =>
  change.anchor === null || change.anchor.kind === "region" ? undefined : change.anchor.region;

/** The version changed at every place the request named, and nowhere else. */
export const changedWhereRequested: SelfCheck = {
  name: "changed-where-requested",
  run: ({ expectedChanges, comparison, units }) => {
    if (expectedChanges.length === 0) {
      return { status: "skipped", findings: ["The request named no place to change."] };
    }
    if (comparison === null) {
      return {
        status: "skipped",
        findings: ["This is the first version; there is nothing to compare."],
      };
    }
    const changed = comparison.units.filter(
      (change) => change.status === "changed" || change.status === "added",
    );
    const findings: string[] = [];
    for (const expected of expectedChanges) {
      const landed = changed.some(
        (change) =>
          change.targetIndex !== null &&
          anchorCoversChange(expected, units, change.targetIndex, changeRegion(change)),
      );
      if (!landed)
        findings.push(`Expected a change at ${describeAnchor(expected)}, but it looks the same.`);
    }
    for (const change of comparison.units) {
      if (change.status === "unchanged") continue;
      const covered =
        change.targetIndex !== null &&
        expectedChanges.some((expected) =>
          anchorCoversChange(expected, units, change.targetIndex!, changeRegion(change)),
        );
      if (covered) continue;
      findings.push(
        change.anchor === null
          ? `Something ${change.status} outside the request.`
          : `${describeAnchor(change.anchor)} ${change.status}, outside the request.`,
      );
    }
    return findings.length === 0
      ? { status: "passed", findings: ["Changed exactly where the request said."] }
      : { status: "failed", findings };
  },
};

/** Runs `checks` in order and reports the first that fails, else the last that ran. */
const layerWith = (checks: ReadonlyArray<SelfCheck>) =>
  Layer.succeed(
    DeliverableSelfCheck,
    DeliverableSelfCheck.of({
      run: Effect.fn("DeliverableSelfCheck.run")(function* (input) {
        const checkedAt = yield* DateTime.now;
        let last: (SelfCheckVerdict & { readonly check: string }) | undefined;
        for (const check of checks) {
          const verdict = check.run(input);
          last = { ...verdict, check: check.name };
          if (verdict.status === "failed") break;
        }
        return last === undefined
          ? { check: "none", status: "skipped", findings: [], checkedAt }
          : { check: last.check, status: last.status, findings: [...last.findings], checkedAt };
      }),
    }),
  );

export const layer = layerWith([changedWhereRequested]);
