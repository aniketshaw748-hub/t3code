import type { DeliverableVersion, DeliverableVersionId } from "@t3tools/contracts";
import { buildVersionGraph, redoTarget, undoTarget } from "@t3tools/shared/deliverableVersionGraph";

export interface VersionStripItem {
  readonly version: DeliverableVersion;
  readonly isCurrent: boolean;
  /** Off the line from V1 to the current version and its redo path; still restorable. */
  readonly alternate: boolean;
  /** Set on a version made after an undo: the ordinal it branched from. */
  readonly forkedFromOrdinal: number | null;
}

/** V1..Vn in order, marking the current one and the branches undo left behind. */
export function versionStrip(
  versions: ReadonlyArray<DeliverableVersion>,
  currentVersionId: DeliverableVersionId | null,
): ReadonlyArray<VersionStripItem> {
  const byId = new Map(versions.map((version) => [version.id, version]));
  const nodes = new Map(
    buildVersionGraph(versions, currentVersionId).map((node) => [node.versionId, node]),
  );
  return [...versions]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((version) => {
      const node = nodes.get(version.id);
      const parent =
        version.parentVersionId === null ? undefined : byId.get(version.parentVersionId);
      // A fork is a version whose parent is not the version just before it.
      const forked = parent !== undefined && parent.ordinal !== version.ordinal - 1;
      return {
        version,
        isCurrent: version.id === currentVersionId,
        alternate: node?.alternate ?? false,
        forkedFromOrdinal: forked ? parent.ordinal : null,
      };
    });
}

export interface HistoryAction {
  readonly enabled: boolean;
  readonly target: DeliverableVersionId | null;
  /** Why it is unavailable, in words for a tooltip; null when enabled. */
  readonly reason: string | null;
}

export interface HistoryAvailability {
  readonly undo: HistoryAction;
  readonly redo: HistoryAction;
  /** Restoring another version is refused for the same reasons as undo and redo. */
  readonly restoreBlockedReason: string | null;
}

export function historyAvailability(input: {
  readonly versions: ReadonlyArray<DeliverableVersion>;
  readonly currentVersionId: DeliverableVersionId | null;
  readonly turnRunning: boolean;
  readonly canOperate: boolean;
  readonly pending: boolean;
}): HistoryAvailability {
  const blocked = !input.canOperate
    ? "This connection can't change files."
    : input.turnRunning
      ? "Available when the agent finishes this turn."
      : input.pending
        ? "Moving to another version…"
        : null;
  const action = (target: DeliverableVersionId | null, none: string): HistoryAction =>
    blocked !== null
      ? { enabled: false, target, reason: blocked }
      : target === null
        ? { enabled: false, target, reason: none }
        : { enabled: true, target, reason: null };
  return {
    undo: action(undoTarget(input.versions, input.currentVersionId), "This is the first version."),
    redo: action(redoTarget(input.versions, input.currentVersionId), "Nothing to redo."),
    restoreBlockedReason: blocked,
  };
}
