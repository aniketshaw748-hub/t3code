import { describe, expect, it } from "@effect/vitest";
import { DIRECT_PUSH_USER_ID, EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { RelayAgentActivityState } from "@t3tools/contracts/relay";
import { makeAggregateState } from "@t3tools/shared/agentActivityAggregate";
import * as DateTime from "effect/DateTime";

import { isRetainedActivityRow, planDirectPushMessage } from "./directPushMessages.ts";

const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));
const preferences = {
  liveActivitiesEnabled: true,
  notificationsEnabled: true,
  notifyOnApproval: true,
  notifyOnInput: true,
  notifyOnCompletion: true,
  notifyOnFailure: true,
};

function state(
  phase: RelayAgentActivityState["phase"],
  overrides: Partial<RelayAgentActivityState> = {},
): RelayAgentActivityState {
  return {
    environmentId: EnvironmentId.make("env"),
    threadId: ThreadId.make("thread"),
    projectTitle: "Project",
    threadTitle: "Fix the build",
    modelTitle: "Haiku",
    headline: "Working",
    phase,
    updatedAt: iso(NOW - 1_000),
    deepLink: "/threads/env/thread",
    ...overrides,
  };
}

function plan(input: {
  readonly rows: ReadonlyArray<RelayAgentActivityState>;
  readonly state: RelayAgentActivityState | null;
  readonly previous: ReadonlyArray<RelayAgentActivityState> | null;
  readonly replay?: boolean;
  readonly preferences?: typeof preferences;
}) {
  return planDirectPushMessage({
    deviceId: "phone",
    preferences: input.preferences ?? preferences,
    previousAggregate:
      input.previous === null
        ? null
        : makeAggregateState({ activeStates: input.previous, terminalState: null, nowMs: NOW }),
    rows: input.rows,
    state: input.state,
    replay: input.replay ?? false,
    nowMs: NOW,
  });
}

describe("planDirectPushMessage", () => {
  it("stamps the direct identity the phone's native handler gates on", () => {
    const running = state("running");
    const message = plan({ rows: [running], state: running, previous: [] });
    expect(message?.data).toMatchObject({
      t3_kind: "agent_activity",
      device_id: "phone",
      user_id: DIRECT_PUSH_USER_ID,
      updated_at: String(NOW),
      active: "true",
      activity_line_0: "Working\tFix the build\tProject",
    });
    expect(message?.alertKey).toBeNull();
  });

  it("alerts on finishing, needing approval and asking for input, once each", () => {
    for (const phase of [
      "completed",
      "failed",
      "waiting_for_approval",
      "waiting_for_input",
    ] as const) {
      const next = state(phase);
      const message = plan({ rows: [next], state: next, previous: [state("running")] });
      expect(message?.alertKey, phase).not.toBeNull();
      expect(message?.data.alert_title).toBe("Fix the build");
      expect(message?.data.alert_path).toBe("/threads/env/thread");
      // Delivering the same aggregate again must not buzz the phone a second time.
      expect(
        plan({ rows: [next], state: next, previous: [next] })?.alertKey ?? null,
        phase,
      ).toBeNull();
    }
  });

  it("respects per-kind preferences and the master switch", () => {
    const done = state("completed");
    expect(
      plan({
        rows: [done],
        state: done,
        previous: [state("running")],
        preferences: { ...preferences, notifyOnCompletion: false },
      })?.alertKey ?? null,
    ).toBeNull();
    expect(
      plan({
        rows: [done],
        state: done,
        previous: null,
        preferences: { ...preferences, notificationsEnabled: false },
      }),
    ).toBeNull();
  });

  it("repaints without alerting on replays, and skips notification-only work in progress", () => {
    const done = state("completed");
    const replay = plan({ rows: [done], state: null, previous: null, replay: true });
    expect(replay?.alertKey).toBeNull();
    expect(replay?.data.activity_phase).toBe("completed");

    const running = state("running");
    expect(
      plan({
        rows: [running],
        state: running,
        previous: null,
        preferences: { ...preferences, liveActivitiesEnabled: false },
      }),
    ).toBeNull();
    const finished = plan({
      rows: [done],
      state: done,
      previous: null,
      preferences: { ...preferences, liveActivitiesEnabled: false },
    });
    expect(finished?.alertKey).not.toBeNull();
    expect(finished?.nextAggregate).toBeNull();
  });

  it("does not alert for a finish older than the freshness window", () => {
    const stale = state("completed", { updatedAt: iso(NOW - 10 * 60_000) });
    expect(plan({ rows: [stale], state: stale, previous: null })?.alertKey ?? null).toBeNull();
  });
});

describe("isRetainedActivityRow", () => {
  it("drops finished rows after the card TTL and expired running rows", () => {
    expect(isRetainedActivityRow(state("completed"), NOW)).toBe(true);
    expect(
      isRetainedActivityRow(state("completed", { updatedAt: iso(NOW - 16 * 60_000) }), NOW),
    ).toBe(false);
    expect(
      isRetainedActivityRow(state("running", { updatedAt: iso(NOW - 3 * 60 * 60_000) }), NOW),
    ).toBe(false);
  });
});
