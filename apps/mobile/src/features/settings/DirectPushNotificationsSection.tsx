import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { BRAND } from "@t3tools/contracts/brand";
import * as Notifications from "expo-notifications";
import { AsyncResult } from "effect/reactivity";
import { useState, useSyncExternalStore } from "react";
import { Linking, Platform } from "react-native";

import * as Dialog from "../../components/ui/Dialog";
import { makePermissionStatusAtom } from "../../lib/permissionStatusAtom";
import { runtime } from "../../lib/runtime";
import { loadOrCreateAgentAwarenessDeviceId } from "../../persistence/imperative";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import {
  openAndroidNotificationSettings,
  readAndroidNotificationState,
} from "../agent-awareness/androidNotifications";
import {
  type DirectPushHostStatus,
  getDirectPushHostStatuses,
  refreshDirectPushRegistration,
  subscribeDirectPushHostStatuses,
} from "../agent-awareness/directPushRegistration";
import { requestAgentNotificationPermission } from "../agent-awareness/notificationPermissions";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

const permissionAtom = makePermissionStatusAtom<"checking" | "granted" | "denied">({
  label: "mobile:direct-push-permission",
  initial: "checking",
  read: async () =>
    (await Notifications.getPermissionsAsync().catch(() => null))?.granted ? "granted" : "denied",
});

export function directPushStatusText(status: DirectPushHostStatus | undefined): string {
  switch (status?.state) {
    case undefined:
      return "Not connected";
    case "registering":
      return "Registering…";
    case "registered":
      return status.configured
        ? "Notifications on"
        : "Registered. The computer has no Firebase key yet: add it in Settings → General → Phone notifications (direct).";
    case "permission-needed":
      return "Allow notifications to register";
    case "relay":
      return "Delivered through T3 Connect";
    case "failed":
      return `Couldn't register: ${status.error}`;
  }
}

/**
 * Notifications sent straight from paired computers through their own Firebase project,
 * used when no T3 Connect account owns this phone's notifications.
 */
export function DirectPushNotificationsSection() {
  const permission = useAtomValue(permissionAtom);
  const setPermission = useAtomSet(permissionAtom);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const { savedConnectionsById } = useSavedRemoteConnections();
  const statuses = useSyncExternalStore(
    subscribeDirectPushHostStatuses,
    getDirectPushHostStatuses,
    getDirectPushHostStatuses,
  );
  const sendTest = useAtomCommand(serverEnvironment.sendDirectPushTest, { reportFailure: false });
  const [testing, setTesting] = useState<EnvironmentId | null>(null);
  if (Platform.OS !== "android") return null;

  const native = readAndroidNotificationState();
  const ongoing = AsyncResult.isSuccess(preferences)
    ? preferences.value.liveActivitiesEnabled !== false
    : true;
  const hosts = Object.values(savedConnectionsById).filter(
    (connection) => connection.relayManaged !== true,
  );

  const requestPermission = async () => {
    const result = await runtime.runPromise(requestAgentNotificationPermission).catch(() => null);
    if (result?.type === "granted") {
      setPermission("granted");
      refreshDirectPushRegistration();
      return;
    }
    Dialog.alert(
      "Notifications are off",
      `Allow notifications for ${BRAND.displayName} in Android Settings to get agent alerts.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open Settings", onPress: () => void Linking.openSettings() },
      ],
    );
  };

  const test = async (environmentId: EnvironmentId, label: string) => {
    setTesting(environmentId);
    const deviceId = await loadOrCreateAgentAwarenessDeviceId();
    const result = await sendTest({ environmentId, input: { deviceId } });
    setTesting(null);
    if (result._tag !== "Success") {
      Dialog.alert("Test failed", `${label} did not answer. Is it connected?`);
      return;
    }
    const delivery = result.value.deliveries[0];
    if (!delivery) {
      Dialog.alert(
        "Not registered yet",
        `${label} has no registration from this phone. Allow notifications, then open this screen again.`,
      );
    } else if (!delivery.ok) {
      Dialog.alert("Test failed", delivery.error ?? "The notification could not be sent.");
    }
  };

  return (
    <>
      <SettingsSection title="Direct from your computers">
        {permission !== "granted" ? (
          <SettingsRow
            icon="bell.badge"
            label="Allow notifications"
            value="Needed for agent alerts"
            onPress={() => void requestPermission()}
          />
        ) : null}
        {native?.alertsBlocked ? (
          <SettingsRow
            icon="exclamationmark.triangle"
            label="Agent alerts are turned off"
            value="Turn the “Agent alerts” category back on"
            onPress={() => void openAndroidNotificationSettings("agent-alerts")}
          />
        ) : null}
        {native?.activityBlocked && ongoing ? (
          <SettingsRow
            icon="exclamationmark.triangle"
            label="Ongoing activity is turned off"
            value="Turn the “Ongoing agent activity” category back on"
            onPress={() => void openAndroidNotificationSettings("agent-activity")}
          />
        ) : null}
        <SettingsSwitchRow
          icon="bolt.circle"
          label="Ongoing Agent Activity"
          subtitle="A live card while agents work"
          value={ongoing}
          onValueChange={(enabled) => {
            savePreferences({ liveActivitiesEnabled: enabled });
            refreshDirectPushRegistration();
          }}
        />
        {native?.bubblesSupported ? (
          <SettingsRow
            icon="bubble.left.and.bubble.right"
            label="Thread bubbles"
            value={
              native.bubblesBlocked
                ? "Off in Android settings"
                : "Running threads can float as bubbles"
            }
            onPress={() => void openAndroidNotificationSettings(null)}
          />
        ) : null}
      </SettingsSection>
      <SettingsSection title="Computers">
        {hosts.length === 0 ? (
          <SettingsRow
            icon="server.rack"
            label="No paired computer"
            value="Pair one in Settings → Environments"
          />
        ) : (
          hosts.map((host) => (
            <SettingsRow
              key={host.environmentId}
              icon="server.rack"
              label={host.environmentLabel}
              value={
                testing === host.environmentId
                  ? "Sending a test notification…"
                  : `${directPushStatusText(statuses.get(host.environmentId))} · Tap to send a test`
              }
              disabled={testing !== null}
              onPress={() => void test(host.environmentId, host.environmentLabel)}
            />
          ))
        )}
      </SettingsSection>
    </>
  );
}
