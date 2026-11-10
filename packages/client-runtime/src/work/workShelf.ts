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
  | "working"
  | "failed"
  | "notes-back"
  | "in-review"
  | "final"
  | "notes-open"
  | "notes-fixing"
  | "notes-fixed"
  | "resolved"
  | "ready"
  | "empty";

export interface ShelfStatus {
  readonly kind: ShelfStatusKind;
  /** The status in plain words: `Agent working · slide 4 of 9`, `2 notes open`, `In review`. */
  readonly label: string;
  /** The version the status is about, as `V2`; null before the first version. */
  readonly version: string | null;
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
      detail: "Retry sends the same request again.",
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

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Where the user's own notes stand, most pressing first; null when there are none. */
function notesStatus(
  notes: ReadonlyArray<Pick<DeliverableNote, "status">>,
): Pick<ShelfStatus, "kind" | "label"> | null {
  if (notes.length === 0) return null;
  const count = (status: DeliverableNote["status"]) =>
    notes.filter((note) => note.status === status).length;
  const open = count("open");
  const fixed = count("fixed");
  const fixing = count("fixing");
  const parts = [
    open > 0 ? plural(open, "note open", "notes open") : null,
    fixed > 0 ? `${fixed} fixed to check` : null,
    fixing > 0 ? `${fixing} with the agent` : null,
  ].filter((part) => part !== null);
  if (parts.length === 0) return { kind: "resolved", label: "All notes resolved" };
  return {
    kind: open > 0 ? "notes-open" : fixed > 0 ? "notes-fixed" : "notes-fixing",
    label: parts.join(" · "),
  };
}

/**
 * One status per project card, in words, most pressing first: a question or spend waiting on the
 * user, a render in progress, the agent working, its last run failing, review notes back, in
 * review, final, then where the user's own notes stand. The version rides beside it.
 */
export function shelfStatus(input: {
  readonly snapshot: WorkProjectSnapshot | null;
  readonly threads: ReadonlyArray<ShelfThread>;
  /** The running agent's latest message, when the caller reads it. */
  readonly agentText: string | null;
}): ShelfStatus {
  const { snapshot, threads } = input;
  const deliverable = snapshot === null ? null : primaryDeliverable(snapshot.deliverables);
  const current =
    snapshot === null || deliverable === null
      ? undefined
      : snapshot.versions.find((version) => version.id === deliverable.currentVersionId);
  const version = current === undefined ? null : `V${current.ordinal}`;
  const waiting = threads.some(
    (thread) => thread.status === "waiting" || thread.pendingRuntimeRequest !== null,
  );
  if (waiting) return { kind: "waiting", label: "Waiting for you", version };
  const running = threads.find((thread) => thread.activeRunId !== null);
  const progress = agentProgress(running === undefined ? null : input.agentText);
  const renderingNow =
    current !== undefined &&
    (current.renditionStatus === "pending" || current.renditionStatus === "rendering");
  if (running !== undefined && progress.renderPercent !== null) {
    return { kind: "rendering", label: `Rendering ${progress.renderPercent}%`, version };
  }
  if (renderingNow) return { kind: "rendering", label: "Rendering", version };
  if (running !== undefined) {
    return {
      kind: "working",
      label:
        progress.step === null ? "Agent working" : `Agent working · ${progress.step.toLowerCase()}`,
      version,
    };
  }
  // The most recently updated thread is the Work thread; its last run is the one that counts.
  const failure = workRunFailure(threads[0]);
  if (failure !== null) return { kind: "failed", label: failure.title, version };
  if (snapshot === null || deliverable === null || current === undefined) {
    return { kind: "empty", label: "Not started", version: null };
  }
  const notesBack = snapshot.notes.filter(
    (note) =>
      note.deliverableId === deliverable.id &&
      note.author.kind === "external" &&
      note.status === "open",
  ).length;
  if (notesBack > 0) return { kind: "notes-back", label: `Notes back · ${notesBack}`, version };
  const review = snapshot.reviews.find((candidate) => candidate.deliverableId === deliverable.id);
  if (review?.state === "in_review") {
    const reviewed = snapshot.versions.find((candidate) => candidate.id === review.versionId);
    return { kind: "in-review", label: "In review", version: `V${(reviewed ?? current).ordinal}` };
  }
  if (review?.state === "final") return { kind: "final", label: "Final", version };
  // The card stands for the project, so its notes count across every deliverable in it.
  return {
    ...(notesStatus(snapshot.notes) ?? { kind: "ready", label: "Ready to review" }),
    version,
  };
}
