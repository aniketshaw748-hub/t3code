import { threadKey } from "@t3tools/client-runtime/state/entities";
import {
  type EnvironmentThreadShell,
  resolveThreadWorkingStartedAt,
} from "@t3tools/client-runtime/state/models";
import { workRunFailure } from "@t3tools/client-runtime/work/shelf";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { resolveSidebarThreadStatus } from "../Sidebar.logic";
import { plainLine } from "./bubbleText";

/** How a thread reads in the bubble, most urgent first. */
export type BubbleThreadTone = "attention" | "working" | "failed" | "done";

export interface BubbleThread {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly projectTitle: string | null;
  readonly tone: BubbleThreadTone;
  readonly statusLabel: string;
  /** One line of what the thread is doing or saying now. */
  readonly nowLine: string;
  /** When the current run started, for the elapsed time of a working thread. */
  readonly workingSince: string | null;
}

export interface BubbleStackSummary {
  readonly count: number;
  /** The tone of each drawn disc, front first; the stack draws at most three. */
  readonly discs: ReadonlyArray<BubbleThreadTone>;
  readonly tone: BubbleThreadTone | "idle";
  readonly attentionCount: number;
  /** Share of the listed threads that finished, from 0 to 1. */
  readonly progress: number;
}

const NOW_LINE_MAX = 96;
const MAX_DRAWN_DISCS = 3;
const TONE_ORDER: Record<BubbleThreadTone, number> = {
  attention: 0,
  working: 1,
  failed: 2,
  done: 3,
};

function parseMs(value: string | null | undefined): number | null {
  if (value == null) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A run that ended while the bubble was up. Visits do not count: a minimized window still marks
 * the thread it shows as visited, though nobody saw the run end.
 */
function endedSince(thread: EnvironmentThreadShell, sinceMs: number): boolean {
  const completedAt = parseMs(thread.latestRun?.completedAt);
  return completedAt !== null && completedAt >= sinceMs;
}

function latestAssistantLine(
  thread: EnvironmentThreadShell,
  pick: "first" | "last",
  afterMs: number | null,
): string | null {
  const message = thread.source.latestVisibleMessage;
  if (message === null || message.role !== "assistant") return null;
  if (afterMs !== null && DateTime.toEpochMillis(message.updatedAt) < afterMs) return null;
  return plainLine(message.text, { max: NOW_LINE_MAX, pick });
}

/** Why the run failed in plain words; an unclassified error keeps its own first line. */
function failedLine(thread: EnvironmentThreadShell): string {
  const failure = workRunFailure(thread.source);
  if (failure !== null && failure.kind !== "error") return failure.detail;
  return (
    plainLine(thread.runtime?.lastError ?? "", { max: NOW_LINE_MAX, pick: "first" }) ??
    "The run failed"
  );
}

function classify(
  thread: EnvironmentThreadShell,
  sinceMs: number,
): Omit<BubbleThread, "key" | "environmentId" | "threadId" | "title" | "projectTitle"> | null {
  const status = resolveSidebarThreadStatus(thread);
  const workingSince = resolveThreadWorkingStartedAt(thread);
  switch (status) {
    case "approval":
      return {
        tone: "attention",
        statusLabel: "Needs approval",
        nowLine:
          thread.pendingSubagentRequest === "approval"
            ? "A subagent is waiting for your approval"
            : "Waiting for your approval",
        workingSince,
      };
    case "input":
      return {
        tone: "attention",
        statusLabel: "Has a question",
        nowLine:
          thread.pendingSubagentRequest === "user_input"
            ? "A subagent has a question for you"
            : "Waiting for your answer",
        workingSince,
      };
    case "request":
      return {
        tone: "attention",
        statusLabel: "Guest message",
        nowLine: "A guest message is waiting for you",
        workingSince,
      };
    case "limited":
      return {
        tone: "attention",
        statusLabel: "Usage limit",
        nowLine: "Paused at a usage limit",
        workingSince: null,
      };
    case "preparing":
      return {
        tone: "working",
        statusLabel: "Preparing",
        nowLine: "Preparing the workspace",
        workingSince,
      };
    case "waiting":
      // An idle provider session also reads as waiting; only a run blocked on another thread is live.
      return thread.blockedOnThreadWait === true
        ? {
            tone: "working",
            statusLabel: "Waiting",
            nowLine: "Waiting on another thread",
            workingSince,
          }
        : null;
    case "working": {
      const task = thread.pendingBackgroundTasks.find(
        (candidate) => (candidate.description ?? "").trim().length > 0,
      );
      return {
        tone: "working",
        statusLabel: "Working",
        nowLine:
          latestAssistantLine(thread, "last", parseMs(workingSince)) ??
          (task?.description
            ? plainLine(task.description, { max: NOW_LINE_MAX, pick: "first" })
            : null) ??
          thread.goal?.objective ??
          "Working",
        workingSince,
      };
    }
    case "failed":
      return endedSince(thread, sinceMs)
        ? {
            tone: "failed",
            statusLabel: "Failed",
            nowLine: failedLine(thread),
            workingSince: null,
          }
        : null;
    case "ready":
      if (!endedSince(thread, sinceMs)) return null;
      if (thread.latestRun?.status === "failed") {
        return {
          tone: "failed",
          statusLabel: "Failed",
          nowLine: "The run failed",
          workingSince: null,
        };
      }
      return thread.latestRun?.status === "completed"
        ? {
            tone: "done",
            statusLabel: "Done",
            nowLine: latestAssistantLine(thread, "first", null) ?? "Finished",
            workingSince: null,
          }
        : null;
  }
}

/**
 * The threads the bubble lists: everything running or waiting on the user, plus runs that ended
 * since the bubble appeared, most urgent first.
 */
export function selectBubbleThreads(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projectTitle: (thread: EnvironmentThreadShell) => string | null;
  readonly sinceMs: number;
}): BubbleThread[] {
  const listed: Array<BubbleThread & { readonly activityMs: number }> = [];
  for (const thread of input.threads) {
    if (thread.archivedAt !== null || thread.deletedAt !== null) continue;
    const classified = classify(thread, input.sinceMs);
    if (classified === null) continue;
    listed.push({
      ...classified,
      key: threadKey({ environmentId: thread.environmentId, threadId: thread.id }),
      environmentId: thread.environmentId,
      threadId: thread.id,
      title: thread.title,
      projectTitle: input.projectTitle(thread),
      activityMs: parseMs(thread.latestRun?.completedAt) ?? parseMs(classified.workingSince) ?? 0,
    });
  }
  listed.sort(
    (left, right) =>
      TONE_ORDER[left.tone] - TONE_ORDER[right.tone] || right.activityMs - left.activityMs,
  );
  return listed.map(({ activityMs: _activityMs, ...thread }) => thread);
}

export function summarizeBubbleStack(threads: ReadonlyArray<BubbleThread>): BubbleStackSummary {
  const finished = threads.filter((thread) => thread.tone === "done" || thread.tone === "failed");
  const attentionCount = threads.filter((thread) => thread.tone === "attention").length;
  return {
    count: threads.length,
    discs: threads.slice(0, MAX_DRAWN_DISCS).map((thread) => thread.tone),
    tone: threads[0]?.tone ?? "idle",
    attentionCount,
    progress: threads.length === 0 ? 0 : finished.length / threads.length,
  };
}
