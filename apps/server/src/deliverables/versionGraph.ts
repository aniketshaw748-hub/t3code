import type { DeliverableVersionGraphNode, DeliverableVersionId } from "@t3tools/contracts";

export interface GraphVersion {
  readonly id: DeliverableVersionId;
  readonly ordinal: number;
  readonly parentVersionId: DeliverableVersionId | null;
}

export const nextVersionOrdinal = (versions: ReadonlyArray<GraphVersion>): number =>
  versions.reduce((max, version) => Math.max(max, version.ordinal), 0) + 1;

/** Undo steps to the parent: the version the current one was made from. */
export function undoTarget(
  versions: ReadonlyArray<GraphVersion>,
  currentId: DeliverableVersionId | null,
): DeliverableVersionId | null {
  return versions.find((version) => version.id === currentId)?.parentVersionId ?? null;
}

/** Redo steps to the newest child, so a fork made after an undo wins over the line it left. */
export function redoTarget(
  versions: ReadonlyArray<GraphVersion>,
  currentId: DeliverableVersionId | null,
): DeliverableVersionId | null {
  if (currentId === null) return null;
  let newest: GraphVersion | undefined;
  for (const version of versions) {
    if (version.parentVersionId !== currentId) continue;
    if (newest === undefined || version.ordinal > newest.ordinal) newest = version;
  }
  return newest?.id ?? null;
}

export function buildVersionGraph(
  versions: ReadonlyArray<GraphVersion>,
  currentId: DeliverableVersionId | null,
): ReadonlyArray<DeliverableVersionGraphNode> {
  const parents = new Map(versions.map((version) => [version.id, version.parentVersionId]));
  const line = new Set<DeliverableVersionId>();
  for (let id = currentId; id !== null && !line.has(id); id = parents.get(id) ?? null) {
    line.add(id);
  }
  for (let id = redoTarget(versions, currentId); id !== null && !line.has(id);) {
    line.add(id);
    id = redoTarget(versions, id);
  }
  const byOrdinal = [...versions].sort((a, b) => a.ordinal - b.ordinal);
  return byOrdinal.map((version) => ({
    versionId: version.id,
    ordinal: version.ordinal,
    parentVersionId: version.parentVersionId,
    childVersionIds: byOrdinal
      .filter((child) => child.parentVersionId === version.id)
      .map((child) => child.id),
    isCurrent: version.id === currentId,
    onCurrentLine: line.has(version.id),
    alternate: !line.has(version.id),
  }));
}
