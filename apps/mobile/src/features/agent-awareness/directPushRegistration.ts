import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { request } from "@t3tools/client-runtime/rpc";
import { DIRECT_PUSH_USER_ID, type EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AppState, Platform } from "react-native";

import { loadPreferences } from "../../persistence/imperative";
import * as MobileStorage from "../../persistence/mobile-storage";
import { configureAndroidAgentNotifications } from "./androidNotifications";
import { supportsAgentAwarenessPush } from "./capabilities";
import {
  getAgentAwarenessRelayMode,
  nativePushTokenRegistration,
  subscribeAgentAwarenessRelayMode,
} from "./remoteRegistration";

const REGISTER_TIMEOUT_MS = 15_000;
// Each registration repaints the card from the host; unchanged ones only refresh this often.
const REREGISTER_AFTER_MS = 5 * 60_000;

export type DirectPushHostStatus =
  | { readonly state: "registering" }
  /** `configured` is false while the host has no Firebase service account yet. */
  | { readonly state: "registered"; readonly configured: boolean }
  | { readonly state: "permission-needed" }
  | { readonly state: "relay" }
  | { readonly state: "failed"; readonly error: string };

let statuses: ReadonlyMap<EnvironmentId, DirectPushHostStatus> = new Map();
const statusListeners = new Set<() => void>();

function setStatuses(next: ReadonlyMap<EnvironmentId, DirectPushHostStatus>): void {
  statuses = next;
  for (const listener of statusListeners) listener();
}

export function getDirectPushHostStatuses(): ReadonlyMap<EnvironmentId, DirectPushHostStatus> {
  return statuses;
}

export function subscribeDirectPushHostStatuses(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

let requestSync: (observedPushToken?: string) => void = () => {};

/** Registers again with every paired host, after a permission grant or a preference change. */
export function refreshDirectPushRegistration(): void {
  requestSync();
}

/** The phone's identity on a host; the host echoes both ids, which the native handler checks. */
export function directPushRegistrationInput(input: {
  readonly deviceId: string;
  readonly pushToken: string;
  readonly liveActivitiesEnabled: boolean;
}) {
  return {
    deviceId: input.deviceId,
    label: Constants.deviceName?.trim() || "Android device",
    platform: "android" as const,
    androidApiLevel: Number(Platform.Version),
    ...(Constants.expoConfig?.version ? { appVersion: Constants.expoConfig.version } : {}),
    packageName: Constants.expoConfig?.android?.package?.trim() || "dev.kavyaan.app",
    pushToken: input.pushToken,
    preferences: {
      liveActivitiesEnabled: input.liveActivitiesEnabled,
      notificationsEnabled: true,
      notifyOnApproval: true,
      notifyOnInput: true,
      notifyOnCompletion: true,
      notifyOnFailure: true,
    },
  };
}

/**
 * Without a T3 Connect account, a paired host sends this phone's notifications itself, so the
 * phone hands each host its FCM token over the direct connection it already has.
 */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    if (Platform.OS !== "android") return;
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const storage = yield* MobileStorage.MobileStorage;
    const requests = yield* Queue.sliding<string | undefined>(1);
    requestSync = (observedPushToken) => Queue.offerUnsafe(requests, observedPushToken);
    const registered = new Map<
      EnvironmentId,
      { readonly signature: string; readonly at: number }
    >();

    const sync = Effect.fnUntraced(function* (observedPushToken: string | undefined) {
      const mode = getAgentAwarenessRelayMode();
      if (mode === "unknown" || !supportsAgentAwarenessPush()) return;
      const environmentIds = [...(yield* SubscriptionRef.get(registry.entries)).keys()].map(
        (id) => id as EnvironmentId,
      );
      const deviceId = yield* storage.loadOrCreateAgentAwarenessDeviceId;
      const setAll = (status: DirectPushHostStatus) =>
        setStatuses(new Map(environmentIds.map((id) => [id, status])));

      if (mode === "relay") {
        registered.clear();
        // The relay account owns notifications now; stop hosts sending to a gated-off identity.
        yield* Effect.forEach(
          environmentIds,
          (environmentId) =>
            registry
              .run(environmentId, request(WS_METHODS.directPushUnregisterDevice, { deviceId }))
              .pipe(Effect.timeout(`${REGISTER_TIMEOUT_MS} millis`), Effect.ignoreCause),
          { concurrency: "unbounded", discard: true },
        );
        setAll({ state: "relay" });
        return;
      }

      const preferences = yield* Effect.promise(() =>
        loadPreferences().catch(() => ({ liveActivitiesEnabled: true })),
      );
      const liveActivitiesEnabled = preferences.liveActivitiesEnabled !== false;
      configureAndroidAgentNotifications(deviceId, DIRECT_PUSH_USER_ID, liveActivitiesEnabled);
      const { pushToken } = yield* nativePushTokenRegistration(observedPushToken);
      if (!pushToken) {
        setAll({ state: "permission-needed" });
        return;
      }
      const registration = directPushRegistrationInput({
        deviceId,
        pushToken,
        liveActivitiesEnabled,
      });
      const signature = [
        registration.pushToken,
        registration.label,
        registration.appVersion ?? "",
        String(liveActivitiesEnabled),
      ].join("\n");
      const now = yield* Clock.currentTimeMillis;
      const due = environmentIds.filter((id) => {
        const last = registered.get(id);
        return last?.signature !== signature || now - last.at > REREGISTER_AFTER_MS;
      });
      setStatuses(
        new Map(environmentIds.map((id) => [id, statuses.get(id) ?? { state: "registering" }])),
      );
      const results = yield* Effect.forEach(
        due,
        (environmentId) =>
          registry
            .run(environmentId, request(WS_METHODS.directPushRegisterDevice, registration))
            .pipe(
              Effect.timeout(`${REGISTER_TIMEOUT_MS} millis`),
              Effect.map((result): DirectPushHostStatus => {
                registered.set(environmentId, { signature, at: now });
                return { state: "registered", configured: result.configured };
              }),
              Effect.catchCause((cause) =>
                Effect.succeed<DirectPushHostStatus>({
                  state: "failed",
                  error: Cause.pretty(cause).split("\n")[0] ?? "Registration failed.",
                }),
              ),
              Effect.map((status) => [environmentId, status] as const),
            ),
        { concurrency: "unbounded" },
      );
      const next = new Map(statuses);
      for (const id of next.keys()) if (!environmentIds.includes(id)) next.delete(id);
      for (const [id, status] of results) next.set(id, status);
      setStatuses(next);
    });

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const appState = AppState.addEventListener("change", (state) => {
          if (state === "active") requestSync();
        });
        const pushToken = Notifications.addPushTokenListener((token) => {
          if (typeof token.data === "string" && token.data.trim()) requestSync(token.data.trim());
        });
        const relayMode = subscribeAgentAwarenessRelayMode(() => requestSync());
        return { appState, pushToken, relayMode };
      }),
      ({ appState, pushToken, relayMode }) =>
        Effect.sync(() => {
          appState.remove();
          pushToken.remove();
          relayMode();
          requestSync = () => {};
        }),
    );
    yield* SubscriptionRef.changes(registry.entries).pipe(
      Stream.runForEach(() => Effect.sync(() => requestSync())),
      Effect.forkScoped,
    );
    yield* Stream.fromQueue(requests).pipe(
      Stream.debounce("250 millis"),
      // Not `ignore`: an interrupt from a torn-down environment must not end the loop.
      Stream.runForEach((token) => sync(token).pipe(Effect.ignoreCause)),
      Effect.forkScoped,
    );
  }),
);
