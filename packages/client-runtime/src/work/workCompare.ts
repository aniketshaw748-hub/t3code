import type {
  DeliverableComparison,
  DeliverableVersion,
  DeliverableVersionId,
} from "@t3tools/contracts";

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

const RENDERING = new Set<DeliverableVersion["renditionStatus"]>(["pending", "rendering"]);
const NOT_RENDERED = new Set<DeliverableVersion["renditionStatus"]>(["failed", "unsupported"]);

/**
 * Whether an answer that the versions could not be compared was overtaken by how they render
 * now, so asking again will say something else: the render it waited for ended, or the version
 * that failed is rendering again.
 */
export function comparisonIsOutdated(
  comparison: Pick<DeliverableComparison, "unavailable">,
  versions: ReadonlyArray<Pick<DeliverableVersion, "id" | "renditionStatus">>,
): boolean {
  const { unavailable } = comparison;
  if (unavailable === null) return false;
  if (unavailable.reason === "rendering") {
    return versions.every((version) => !RENDERING.has(version.renditionStatus));
  }
  const held = versions.find((version) => version.id === unavailable.versionId);
  return (
    (unavailable.reason === "render_failed" || unavailable.reason === "source_missing") &&
    held !== undefined &&
    !NOT_RENDERED.has(held.renditionStatus)
  );
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
