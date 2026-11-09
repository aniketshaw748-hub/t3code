import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  EnvironmentId,
  MessageId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import { selectBubbleThreads, summarizeBubbleStack } from "./bubbleThreads.logic";

const environmentId = EnvironmentId.make("environment-test");
const at = (iso: string) => DateTime.makeUnsafe(iso);
const SHOWN_AT = Date.parse("2026-06-20T10:00:00.000Z");

function shell(id: string, overrides: Partial<OrchestrationV2ThreadShell>) {
  return presentThreadShell(environmentId, {
    ...makeThreadFixture().source,
    id: ThreadId.make(id),
    title: id,
    ...overrides,
  });
}

const running = (id: string, startedAt: string, extra: Partial<OrchestrationV2ThreadShell> = {}) =>
  shell(id, {
    latestRunId: RunId.make(`run-${id}`),
    activeRunId: RunId.make(`run-${id}`),
    status: "running",
    activityRunStatus: "running",
    activityRunStartedAt: at(startedAt),
    ...extra,
  });

const select = (threads: ReturnType<typeof shell>[]) =>
  selectBubbleThreads({ threads, projectTitle: () => "Project", sinceMs: SHOWN_AT });

describe("selectBubbleThreads", () => {
  it("lists live work and attention, most urgent first, and leaves idle threads out", () => {
    const threads = select([
      running("older", "2026-06-20T09:00:00.000Z"),
      shell("idle", {}),
      running("approval", "2026-06-20T09:30:00.000Z", {
        pendingRuntimeRequest: {
          id: RuntimeRequestId.make("request-1"),
          kind: "command",
          createdAt: at("2026-06-20T09:31:00.000Z"),
        },
      }),
      running("newer", "2026-06-20T09:45:00.000Z"),
    ]);
    expect(threads.map((thread) => [thread.threadId, thread.tone, thread.statusLabel])).toEqual([
      ["approval", "attention", "Needs approval"],
      ["newer", "working", "Working"],
      ["older", "working", "Working"],
    ]);
    expect(threads[1]?.workingSince).toBe("2026-06-20T09:45:00.000Z");
  });

  it("says what a working thread is saying in this run, and ignores an older reply", () => {
    const message = (text: string, updatedAt: string) => ({
      id: MessageId.make("message"),
      role: "assistant" as const,
      text,
      updatedAt: at(updatedAt),
    });
    const [fresh] = select([
      running("fresh", "2026-06-20T09:00:00.000Z", {
        latestVisibleMessage: message(
          "Checked the config.\n\nNow running **the tests** in `apps/web`",
          "2026-06-20T09:05:00.000Z",
        ),
      }),
    ]);
    expect(fresh?.nowLine).toBe("Now running the tests in apps/web");
    const [stale] = select([
      running("stale", "2026-06-20T09:00:00.000Z", {
        latestVisibleMessage: message("Earlier answer", "2026-06-20T08:00:00.000Z"),
      }),
    ]);
    expect(stale?.nowLine).toBe("Working");
  });

  it("keeps runs that ended since the bubble appeared, even in a thread the window shows", () => {
    const ended = (id: string, completedAt: string, visitedAt: string | null) =>
      shell(id, {
        latestRunId: RunId.make(`run-${id}`),
        status: "completed",
        latestRunCompletedAt: at(completedAt),
        lastVisitedAt: visitedAt === null ? null : at(visitedAt),
      });
    const threads = select([
      ended("before-bubble", "2026-06-20T09:59:00.000Z", null),
      ended("shown-in-window", "2026-06-20T10:05:00.000Z", "2026-06-20T10:05:00.000Z"),
      shell("failed", {
        latestRunId: RunId.make("run-failed"),
        status: "failed",
        latestRunCompletedAt: at("2026-06-20T10:07:00.000Z"),
        lastError: "Provider exited\nwith code 1",
      }),
      shell("signed-out", {
        latestRunId: RunId.make("run-signed-out"),
        status: "failed",
        latestRunCompletedAt: at("2026-06-20T10:06:00.000Z"),
        lastError: "OAuth token has expired",
        lastErrorClass: "provider_error",
      }),
    ]);
    expect(threads.map((thread) => [thread.threadId, thread.tone, thread.nowLine])).toEqual([
      ["failed", "failed", "Provider exited"],
      [
        "signed-out",
        "failed",
        "The agent's sign-in expired or was refused. Sign in again in Settings, then retry.",
      ],
      ["shown-in-window", "done", "Finished"],
    ]);
  });

  it("leaves out archived threads", () => {
    expect(
      select([
        running("archived", "2026-06-20T09:00:00.000Z", {
          archivedAt: at("2026-06-20T09:10:00.000Z"),
        }),
      ]),
    ).toEqual([]);
  });
});

describe("summarizeBubbleStack", () => {
  it("draws at most three discs and measures progress as the finished share", () => {
    const threads = select([
      running("a", "2026-06-20T09:00:00.000Z"),
      running("b", "2026-06-20T09:01:00.000Z"),
      running("c", "2026-06-20T09:02:00.000Z"),
      shell("done", {
        latestRunId: RunId.make("run-done"),
        status: "completed",
        latestRunCompletedAt: at("2026-06-20T10:01:00.000Z"),
      }),
    ]);
    expect(summarizeBubbleStack(threads)).toEqual({
      count: 4,
      discs: ["working", "working", "working"],
      tone: "working",
      attentionCount: 0,
      progress: 0.25,
    });
    expect(summarizeBubbleStack([])).toMatchObject({ count: 0, tone: "idle", progress: 0 });
  });
});
