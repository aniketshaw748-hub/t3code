import type {
  DeliverableNote,
  DeliverableVersion,
  DeliverableVersionId,
  RunId,
} from "@t3tools/contracts";

type LifecycleNote = Pick<
  DeliverableNote,
  "id" | "deliverableId" | "status" | "sentRunId" | "addressedRunId" | "reply" | "fixedInVersionId"
>;
type RunVersion = Pick<DeliverableVersion, "id" | "deliverableId" | "ordinal" | "summary">;

export type NotePatch = Partial<Pick<DeliverableNote, "status" | "reply" | "fixedInVersionId">> & {
  readonly noteId: LifecycleNote["id"];
};

function latestByDeliverable(versions: ReadonlyArray<RunVersion>) {
  const latest = new Map<string, RunVersion>();
  for (const version of versions) {
    const current = latest.get(version.deliverableId);
    if (current === undefined || version.ordinal > current.ordinal) {
      latest.set(version.deliverableId, version);
    }
  }
  return latest;
}

/**
 * Notes the agent marked are fixed in the run's newest version of their deliverable. When it
 * marked none there, the run's end (`final`) fixes every note it was sent, replying with the
 * version summary. Sent notes left without a version at the end go back to open.
 */
export function settleRunNotes(input: {
  readonly notes: ReadonlyArray<LifecycleNote>;
  readonly runId: RunId;
  /** Every version recorded in the run, across the project's deliverables. */
  readonly runVersions: ReadonlyArray<RunVersion>;
  readonly final: boolean;
}): ReadonlyArray<NotePatch> {
  const { runId } = input;
  const latest = latestByDeliverable(input.runVersions);
  const explicitDeliverables = new Set(
    input.notes
      .filter((note) => note.addressedRunId === runId)
      .map((note) => note.deliverableId as string),
  );
  const fixedIn = (version: RunVersion): DeliverableVersionId => version.id;
  const patches: NotePatch[] = [];
  for (const note of input.notes) {
    if (note.status === "resolved") continue;
    if (note.addressedRunId !== runId && note.sentRunId !== runId) continue;
    const version = latest.get(note.deliverableId);
    if (version !== undefined && note.addressedRunId === runId) {
      if (note.status !== "fixed" || note.fixedInVersionId !== version.id) {
        patches.push({ noteId: note.id, status: "fixed", fixedInVersionId: fixedIn(version) });
      }
      continue;
    }
    if (!input.final || note.status !== "fixing") continue;
    if (version !== undefined && !explicitDeliverables.has(note.deliverableId)) {
      patches.push({
        noteId: note.id,
        status: "fixed",
        fixedInVersionId: fixedIn(version),
        ...(note.reply === null && version.summary !== null ? { reply: version.summary } : {}),
      });
      continue;
    }
    patches.push({ noteId: note.id, status: "open" });
  }
  return patches;
}
