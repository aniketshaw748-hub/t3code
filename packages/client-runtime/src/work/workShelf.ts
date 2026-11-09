import type {
  Deliverable,
  DeliverableVersionId,
  OrchestrationV2ThreadShell,
  WorkProjectSnapshot,
} from "@t3tools/contracts";

import { agentProgress } from "./workNotes.ts";

export type ShelfStatusKind =
  | "waiting"
  | "rendering"
  | "drafting"
  | "notes-back"
  | "in-review"
  | "final"
  | "ready"
  | "empty";

export interface ShelfStatus {
  readonly kind: ShelfStatusKind;
  /** The plain chip text: `Drafting · slide 4 of 9`, `Rendering 60%`, `Notes back · 3`. */
  readonly label: string;
}

type ShelfThread = Pick<
  OrchestrationV2ThreadShell,
  "status" | "activeRunId" | "pendingRuntimeRequest"
>;

/** The deliverable a project card shows: the one changed last. */
export function primaryDeliverable(deliverables: ReadonlyArray<Deliverable>): Deliverable | null {
  return (
    [...deliverables].sort(
      (a, b) => b.updatedAt.epochMilliseconds - a.updatedAt.epochMilliseconds,
    )[0] ?? null
  );
}

export function posterFor(
  snapshot: Pick<WorkProjectSnapshot, "posters">,
  versionId: DeliverableVersionId | null,
): string | null {
  if (versionId === null) return null;
  return snapshot.posters.find((poster) => poster.versionId === versionId)?.url ?? null;
}

/**
 * One status per project card, most pressing first: a question or spend waiting on the user,
 * a render in progress, the agent drafting, review notes back, in review, final, or ready.
 */
export function shelfStatus(input: {
  readonly snapshot: WorkProjectSnapshot | null;
  readonly threads: ReadonlyArray<ShelfThread>;
  /** The running agent's latest message, when the caller reads it. */
  readonly agentText: string | null;
}): ShelfStatus {
  const { snapshot, threads } = input;
  const waiting = threads.some(
    (thread) => thread.status === "waiting" || thread.pendingRuntimeRequest !== null,
  );
  if (waiting) return { kind: "waiting", label: "Waiting for you" };
  const running = threads.find((thread) => thread.activeRunId !== null);
  const progress = agentProgress(running === undefined ? null : input.agentText);
  const deliverable = snapshot === null ? null : primaryDeliverable(snapshot.deliverables);
  const current =
    snapshot === null || deliverable === null
      ? undefined
      : snapshot.versions.find((version) => version.id === deliverable.currentVersionId);
  const renderingNow =
    current !== undefined &&
    (current.renditionStatus === "pending" || current.renditionStatus === "rendering");
  if (running !== undefined && progress.renderPercent !== null) {
    return { kind: "rendering", label: `Rendering ${progress.renderPercent}%` };
  }
  if (renderingNow) return { kind: "rendering", label: "Rendering" };
  if (running !== undefined) {
    return {
      kind: "drafting",
      label: progress.step === null ? "Drafting" : `Drafting · ${progress.step.toLowerCase()}`,
    };
  }
  if (snapshot === null || deliverable === null || current === undefined) {
    return { kind: "empty", label: "Not started" };
  }
  const notesBack = snapshot.notes.filter(
    (note) =>
      note.deliverableId === deliverable.id &&
      note.author.kind === "external" &&
      note.status === "open",
  ).length;
  if (notesBack > 0) return { kind: "notes-back", label: `Notes back · ${notesBack}` };
  const review = snapshot.reviews.find((candidate) => candidate.deliverableId === deliverable.id);
  if (review?.state === "in_review") {
    const reviewed = snapshot.versions.find((version) => version.id === review.versionId);
    return {
      kind: "in-review",
      label: `In review · V${(reviewed ?? current).ordinal}`,
    };
  }
  if (review?.state === "final") return { kind: "final", label: "Final" };
  return { kind: "ready", label: `V${current.ordinal}` };
}
