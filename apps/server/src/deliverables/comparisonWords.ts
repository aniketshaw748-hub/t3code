import type {
  DeliverableComparisonUnavailable,
  DeliverableComparisonUnavailableReason,
  DeliverableKind,
  DeliverableUnitChange,
  DeliverableVersionId,
} from "@t3tools/contracts";

const UNIT_NOUN: Record<DeliverableKind, string> = {
  video: "shot",
  deck: "slide",
  pdf: "page",
  image: "image",
  other: "image",
};

/** `2 slides changed, 1 slide added`, or that nothing visible changed. */
export function comparisonHeadline(
  kind: DeliverableKind,
  units: ReadonlyArray<DeliverableUnitChange>,
): string {
  const noun = UNIT_NOUN[kind];
  const parts = (["changed", "added", "removed", "moved"] as const)
    .map((status) => [status, units.filter((unit) => unit.status === status).length] as const)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${noun}${count === 1 ? "" : "s"} ${status}`);
  return parts.length === 0 ? "No visible change" : parts.join(", ");
}

const UNAVAILABLE_HEADLINE: Record<DeliverableComparisonUnavailableReason, string> = {
  rendering: "Still rendering",
  render_failed: "Not rendered",
  source_missing: "File missing",
  comparison_failed: "Not compared",
};

export const comparisonUnavailableHeadline = (reason: DeliverableComparisonUnavailableReason) =>
  UNAVAILABLE_HEADLINE[reason];

/** Why two versions have no comparison, said about the version that holds it up. */
export function comparisonUnavailable(
  reason: DeliverableComparisonUnavailableReason,
  version: { readonly id: DeliverableVersionId; readonly ordinal: number } | null,
): DeliverableComparisonUnavailable {
  const name = version === null ? "One of these versions" : `V${version.ordinal}`;
  const message: Record<DeliverableComparisonUnavailableReason, string> = {
    rendering: `${name} is still rendering. The comparison appears when it is done.`,
    render_failed: `${name} could not be rendered, so there is nothing to compare it with. Open it to see why and to render it again.`,
    source_missing: `${name}'s file is missing from the store on this computer, so it cannot be compared.`,
    comparison_failed:
      version === null
        ? "These two versions could not be compared."
        : `${name}'s rendered files could not be read, so the comparison failed.`,
  };
  return { reason, versionId: version?.id ?? null, message: message[reason] };
}
