import type {
  Deliverable,
  DeliverableNote,
  DeliverableVersionId,
  OrchestrationV2ThreadShell,
  RunId,
  WorkProjectSnapshot,
} from "@t3tools/contracts";

import { agentProgress } from "./workNotes.ts";

export type ShelfStatusKind =
  | "waiting"
  | "rendering"
  | "drafting"
  | "failed"
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

type FailureThread = Pick<
  OrchestrationV2ThreadShell,
  "status" | "latestRunId" | "lastError" | "lastErrorClass" | "lastErrorCode" | "usageLimitResetAt"
>;

type ShelfThread = Pick<OrchestrationV2ThreadShell, "activeRunId" | "pendingRuntimeRequest"> &
  Partial<FailureThread> &
  Pick<OrchestrationV2ThreadShell, "status">;

/** Why the agent's last run ended early, in plain words, for Work mode to show where it landed. */
export interface WorkRunFailure {
  readonly runId: RunId | null;
  readonly kind: "usage_limit" | "sign_in" | "connection" | "error" | "stopped";
  /** The chip and banner heading: `Usage limit reached`. */
  readonly title: string;
  /** One sentence saying what happened and what to do. */
  readonly detail: string;
  /** When a usage limit lifts, for the client to format. */
  readonly resetAt: string | null;
}

const SIGN_IN_ERROR =
  /\b(?:auth(?:entic\w*|ori[sz]\w*)?|log(?:ged)? ?in|sign(?:ed)? ?in|unauthori[sz]ed|forbidden|401|403|expired|credentials?|api key)\b/i;

/** The failure of the thread's latest run, or null while it runs or after it finished well. */
export function workRunFailure(
  thread: Partial<FailureThread> | null | undefined,
): WorkRunFailure | null {
  if (thread === null || thread === undefined) return null;
  const runId = thread.latestRunId ?? null;
  if (thread.status === "interrupted" || thread.status === "cancelled") {
    return {
      runId,
      kind: "stopped",
      title: "Stopped before it finished",
      detail: "The agent's run was stopped before it saved its work.",
      resetAt: null,
    };
  }
  if (thread.status !== "failed") return null;
  const failureClass = thread.lastErrorClass ?? null;
  const said = `${thread.lastErrorCode ?? ""} ${thread.lastError ?? ""}`;
  if (failureClass === "usage_limit") {
    return {
      runId,
      kind: "usage_limit",
      title: "Usage limit reached",
      detail: "The agent stopped because the provider's usage limit was reached.",
      resetAt: thread.usageLimitResetAt ?? null,
    };
  }
  if (failureClass === "permission_error" || SIGN_IN_ERROR.test(said)) {
    return {
      runId,
      kind: "sign_in",
      title: "Sign-in needed",
      detail: "The agent's sign-in expired or was refused. Sign in again in Settings, then retry.",
      resetAt: null,
    };
  }
  if (failureClass === "transport_error") {
    return {
      runId,
      kind: "connection",
      title: "Connection lost",
      detail: "The connection to the agent dropped before it finished.",
      resetAt: null,
    };
  }
  return {
    runId,
    kind: "error",
    title: "The agent hit an error",
    detail: "The agent stopped with an error before it finished.",
    resetAt: null,
  };
}

/** The failure's sentence, with when a usage limit lifts in the reader's own clock. */
export function workRunFailureDetail(failure: WorkRunFailure): string {
  const reset = failure.resetAt === null ? Number.NaN : Date.parse(failure.resetAt);
  if (!Number.isFinite(reset)) return failure.detail;
  const when = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(reset);
  return `${failure.detail} It resets ${when}.`;
}

/** Open notes the failed run was working on: sending them again is the retry. */
export function notesFromFailedRun<N extends Pick<DeliverableNote, "status" | "sentRunId">>(
  notes: ReadonlyArray<N>,
  failure: WorkRunFailure | null,
): ReadonlyArray<N> {
  if (failure === null || failure.runId === null) return [];
  return notes.filter((note) => note.status === "open" && note.sentRunId === failure.runId);
}

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
 * a render in progress, the agent drafting, its last run failing, review notes back, in review,
 * final, or ready.
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
  // The most recently updated thread is the Work thread; its last run is the one that counts.
  const failure = workRunFailure(threads[0]);
  if (failure !== null) return { kind: "failed", label: failure.title };
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
