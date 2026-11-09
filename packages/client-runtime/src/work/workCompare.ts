import type { DeliverableVersion, DeliverableVersionId } from "@t3tools/contracts";

/** The two versions picked for comparison, kept in the order the user picked them. */
export interface CompareSelection {
  readonly first: DeliverableVersionId;
  readonly second: DeliverableVersionId;
}

type CompareVersion = Pick<DeliverableVersion, "id" | "ordinal" | "parentVersionId">;

/** The current version against the one it was made from, or the one before it. */
export function defaultCompareSelection(
  versions: ReadonlyArray<CompareVersion>,
  currentVersionId: DeliverableVersionId | null,
): CompareSelection | null {
  const current = versions.find((version) => version.id === currentVersionId);
  if (current === undefined) return null;
  const parent =
    versions.find((version) => version.id === current.parentVersionId) ??
    [...versions]
      .filter((version) => version.ordinal < current.ordinal)
      .sort((a, b) => b.ordinal - a.ordinal)[0];
  return parent === undefined ? null : { first: parent.id, second: current.id };
}

/** Picking a version replaces the older of the two picks; picking a picked one changes nothing. */
export function pickCompareVersion(
  selection: CompareSelection,
  versionId: DeliverableVersionId,
): CompareSelection {
  if (versionId === selection.first || versionId === selection.second) return selection;
  return { first: selection.second, second: versionId };
}

/** Base is the lower version, target the higher, whatever order they were picked in. */
export function orderedCompare<V extends CompareVersion>(
  selection: CompareSelection,
  versions: ReadonlyArray<V>,
): { readonly base: V; readonly target: V } | null {
  const first = versions.find((version) => version.id === selection.first);
  const second = versions.find((version) => version.id === selection.second);
  if (first === undefined || second === undefined) return null;
  return first.ordinal <= second.ordinal
    ? { base: first, target: second }
    : { base: second, target: first };
}
