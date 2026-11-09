import { DIRECT_PUSH_USER_ID, type DirectPushPreferences } from "@t3tools/contracts";
import type {
  RelayAgentActivityAggregateState,
  RelayAgentActivityState,
} from "@t3tools/contracts/relay";
import {
  androidActivityData,
  androidAlertForAggregate,
  androidAlertForState,
  fitFcmData,
} from "@t3tools/shared/agentActivityAndroid";
import {
  makeAggregateState,
  TERMINAL_AGENT_ACTIVITY_DISPLAY_TTL_MS,
} from "@t3tools/shared/agentActivityAggregate";
import {
  isExpiredAgentActivityState,
  isTerminalPhase,
} from "@t3tools/shared/agentActivityPayloads";

export interface DirectPushMessagePlan {
  readonly data: Record<string, string>;
  /** Unhashed stable alert identity; the sender hashes it into `alert_id` to fit the payload. */
  readonly alertKey: string | null;
  /** The baseline to store once FCM accepts the message. */
  readonly nextAggregate: RelayAgentActivityAggregateState | null;
}

/**
 * The relay's Android delivery policy for one device of this host: the ongoing card shows
 * every row, and alerts fire on moves into attention or a fresh finish compared with the
 * card last delivered. `state` is the thread that changed; null for deletions and replays.
 */
export function planDirectPushMessage(input: {
  readonly deviceId: string;
  readonly preferences: DirectPushPreferences;
  readonly previousAggregate: RelayAgentActivityAggregateState | null;
  readonly rows: ReadonlyArray<RelayAgentActivityState>;
  readonly state: RelayAgentActivityState | null;
  readonly replay: boolean;
  readonly nowMs: number;
}): DirectPushMessagePlan | null {
  const { preferences, previousAggregate, nowMs } = input;
  const aggregate = makeAggregateState({
    activeStates: preferences.liveActivitiesEnabled ? input.rows : [],
    terminalState: null,
    nowMs,
  });
  let alert: ReturnType<typeof androidAlertForState> = null;
  if (input.state && !input.replay && preferences.notificationsEnabled) {
    if (preferences.liveActivitiesEnabled && previousAggregate && aggregate) {
      alert = androidAlertForAggregate({
        previousAggregate,
        nextAggregate: aggregate,
        preferences,
        nowMs,
      });
    } else if (!isExpiredAgentActivityState(input.state, nowMs)) {
      alert = androidAlertForState(input.state, preferences, nowMs);
    }
  }
  const displayed =
    preferences.notificationsEnabled && preferences.liveActivitiesEnabled ? aggregate : null;
  // Nothing to show, nothing shown before: a running thread for a notification-only device.
  if (!displayed && !alert && !previousAggregate && input.state !== null) return null;
  const { alert_id: alertKey, ...alertFields } = alert ?? { alert_id: null };
  return {
    data: fitFcmData({
      t3_kind: "agent_activity",
      device_id: input.deviceId,
      user_id: DIRECT_PUSH_USER_ID,
      updated_at: String(nowMs),
      ...androidActivityData(displayed),
      ...alertFields,
    }),
    alertKey,
    nextAggregate: preferences.liveActivitiesEnabled ? aggregate : null,
  };
}

/** Rows a later aggregate could still display; finished rows linger for the card's TTL. */
export function isRetainedActivityRow(state: RelayAgentActivityState, nowMs: number): boolean {
  if (isTerminalPhase(state)) {
    return nowMs - Date.parse(state.updatedAt) <= TERMINAL_AGENT_ACTIVITY_DISPLAY_TTL_MS;
  }
  return !isExpiredAgentActivityState(state, nowMs);
}
