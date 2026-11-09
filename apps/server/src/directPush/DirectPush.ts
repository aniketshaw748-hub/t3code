import { BRAND } from "@t3tools/contracts/brand";
import {
  DIRECT_PUSH_USER_ID,
  type DirectPushDeviceRegistrationInput,
  type DirectPushSendTestResult,
  type DirectPushServiceAccountStatus,
  type DirectPushStatus,
  type ThreadId,
} from "@t3tools/contracts";
import type { RelayAgentActivityState } from "@t3tools/contracts/relay";
import { androidActivityData, fitFcmData } from "@t3tools/shared/agentActivityAndroid";
import { makeAggregateState } from "@t3tools/shared/agentActivityAggregate";
import {
  decodeFcmServiceAccountJson,
  makeFcmSender,
  signFcmAssertion,
  type FcmSender,
  type FcmServiceAccount,
} from "@t3tools/shared/fcm";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as DirectPushDevices from "../persistence/DirectPushDevices.ts";
import {
  AgentActivityDeliveryError,
  type AgentActivityDeliveryTarget,
} from "../relay/AgentActivityDeliveryTargets.ts";
import { isRetainedActivityRow, planDirectPushMessage } from "./directPushMessages.ts";

/** Holds the path the user chose; the private key stays in their file, never in our store. */
const DIRECT_PUSH_SERVICE_ACCOUNT_PATH_SECRET = "direct-push-service-account-path";

export class DirectPushError extends Schema.TaggedError<DirectPushError>()("DirectPushError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Direct push ${this.operation} failed.`;
  }
}

const ServiceAccountType = Schema.Struct({ type: Schema.optional(Schema.String) });
const decodeServiceAccountType = Schema.decodeUnknownOption(
  Schema.fromJsonString(ServiceAccountType),
);

function parseServiceAccountFile(
  contents: string,
): { readonly account: FcmServiceAccount } | { readonly reason: string } {
  const type = decodeServiceAccountType(contents);
  if (Option.isNone(type)) return { reason: "The file is not JSON." };
  if (type.value.type !== "service_account") {
    return {
      reason:
        'This is not a service-account key ("type": "service_account"). google-services.json belongs in the app build, not here.',
    };
  }
  const account = decodeFcmServiceAccountJson(contents);
  return Option.isSome(account)
    ? { account: account.value }
    : { reason: "The service-account key is missing project_id, client_email or private_key." };
}

interface LoadedAccount {
  readonly path: string;
  readonly account: FcmServiceAccount;
  readonly sender: FcmSender;
}

export class DirectPush extends Context.Service<
  DirectPush,
  {
    readonly getStatus: Effect.Effect<DirectPushStatus, DirectPushError>;
    readonly setServiceAccount: (
      path: string | null,
    ) => Effect.Effect<DirectPushStatus, DirectPushError>;
    readonly registerDevice: (input: {
      readonly registration: DirectPushDeviceRegistrationInput;
      readonly sessionId: string | null;
    }) => Effect.Effect<{ readonly configured: boolean }, DirectPushError>;
    readonly unregisterDevice: (deviceId: string) => Effect.Effect<void, DirectPushError>;
    /** Forgets phones whose pairing was revoked or expired; runs at start and on every removal. */
    readonly pruneRevokedRegistrations: Effect.Effect<void, DirectPushError>;
    readonly sendTest: (
      deviceId: string | undefined,
    ) => Effect.Effect<DirectPushSendTestResult, DirectPushError>;
    readonly deliveryTarget: AgentActivityDeliveryTarget;
  }
>()("t3/directPush/DirectPush") {}

export const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const fileSystem = yield* FileSystem.FileSystem;
  const devices = yield* DirectPushDevices.DirectPushDeviceRepository;
  const sessions = yield* SessionStore.SessionStore;
  const digest = yield* Digest.Digest;
  const random = yield* SecureRandom.SecureRandom;
  const fetch = yield* FetchHttpClient.Fetch;
  const changes = yield* PubSub.unbounded<void>();
  const rows = new Map<ThreadId, RelayAgentActivityState>();
  let loaded: LoadedAccount | undefined;

  const readPath = secrets.get(DIRECT_PUSH_SERVICE_ACCOUNT_PATH_SECRET).pipe(
    Effect.map((bytes) => (Option.isSome(bytes) ? new TextDecoder().decode(bytes.value) : null)),
    Effect.map((path) => (path?.trim() ? path.trim() : null)),
  );

  const loadAccount = Effect.fn("DirectPush.loadAccount")(function* (path: string) {
    const contents = yield* fileSystem.readFileString(path).pipe(Effect.result);
    if (contents._tag === "Failure") {
      return { status: "invalid", path, reason: "The file can't be read." } as const;
    }
    const parsed = parseServiceAccountFile(contents.success);
    if ("reason" in parsed) return { status: "invalid", path, reason: parsed.reason } as const;
    const sender = yield* makeFcmSender({
      account: parsed.account,
      signAssertion: (assertion) =>
        Effect.tryPromise({
          try: () => signFcmAssertion(globalThis.crypto.subtle, assertion),
          catch: (cause) => new DirectPushError({ operation: "signAssertion", cause }),
        }),
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    );
    loaded = { path, account: parsed.account, sender };
    return {
      status: "configured",
      path,
      projectId: parsed.account.project_id,
      clientEmail: parsed.account.client_email,
    } as const;
  });

  /** Uses the cached sender for an unchanged path; `reload` re-reads the file. */
  const resolveAccount = Effect.fn("DirectPush.resolveAccount")(function* (reload: boolean) {
    const path = yield* readPath;
    if (path === null) {
      loaded = undefined;
      return { status: { status: "not-configured" } as DirectPushServiceAccountStatus, loaded };
    }
    if (!reload && loaded?.path === path) {
      const status: DirectPushServiceAccountStatus = {
        status: "configured",
        path,
        projectId: loaded.account.project_id,
        clientEmail: loaded.account.client_email,
      };
      return { status, loaded };
    }
    loaded = undefined;
    const status: DirectPushServiceAccountStatus = yield* loadAccount(path);
    return { status, loaded };
  });

  const status = Effect.fn("DirectPush.status")(function* (reload: boolean) {
    const account = yield* resolveAccount(reload);
    const records = yield* devices.list;
    return {
      serviceAccount: account.status,
      devices: records.map((record) => ({
        deviceId: record.deviceId,
        label: record.label,
        appVersion: record.appVersion,
        notificationsEnabled: record.preferences.notificationsEnabled,
        updatedAt: record.updatedAt,
        lastDelivery:
          record.lastDeliveryAt === null
            ? null
            : {
                at: record.lastDeliveryAt,
                ok: record.lastDeliveryOk === 1,
                error: record.lastDeliveryError,
              },
      })),
    } satisfies DirectPushStatus;
  });

  const hashAlertKey = (key: string) =>
    digest
      .digest(Digest.sha256, new TextEncoder().encode(key))
      .pipe(
        Effect.map((bytes) =>
          Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
        ),
      );

  /** Sends to one device and records the outcome; UNREGISTERED tokens are forgotten. */
  const sendToDevice = Effect.fn("DirectPush.sendToDevice")(function* (input: {
    readonly sender: FcmSender;
    readonly device: DirectPushDevices.DirectPushDeviceRecord;
    readonly data: Record<string, string>;
    readonly alert: boolean;
    readonly aggregate?: DirectPushDevices.DirectPushDeviceRecord["lastAggregate"];
  }) {
    const at = DateTime.formatIso(yield* DateTime.now);
    const result = yield* input.sender
      .send({
        token: input.device.pushToken,
        packageName: input.device.packageName,
        data: input.data,
        alert: input.alert,
      })
      .pipe(Effect.result);
    if (result._tag === "Success" && result.success.unregistered) {
      yield* devices.removeToken({
        deviceId: input.device.deviceId,
        pushToken: input.device.pushToken,
      });
      yield* Effect.logInfo("direct push token unregistered; device forgotten", {
        deviceId: input.device.deviceId,
      });
      return {
        ok: false,
        retryable: false,
        error: "The phone's notification token is no longer valid.",
      };
    }
    const error = result._tag === "Failure" ? result.failure.message : null;
    yield* devices.markDelivery({
      deviceId: input.device.deviceId,
      at,
      ok: error === null,
      error,
      ...(error === null && input.aggregate !== undefined ? { aggregate: input.aggregate } : {}),
    });
    return { ok: error === null, retryable: error !== null, error };
  });

  const deliver = Effect.fn("DirectPush.deliver")(function* (input: {
    readonly sender: FcmSender;
    readonly state: RelayAgentActivityState | null;
    readonly replay: boolean;
    readonly deviceId?: string;
  }) {
    const nowMs = (yield* DateTime.now).epochMilliseconds;
    const records = (yield* devices.list).filter(
      (record) => input.deviceId === undefined || record.deviceId === input.deviceId,
    );
    return yield* Effect.forEach(
      records,
      (device) =>
        Effect.gen(function* () {
          const plan = planDirectPushMessage({
            deviceId: device.deviceId,
            preferences: device.preferences,
            previousAggregate: device.lastAggregate,
            rows: [...rows.values()],
            state: input.state,
            replay: input.replay,
            nowMs,
          });
          if (plan === null) return { ok: true, retryable: false, error: null };
          const data =
            plan.alertKey === null
              ? plan.data
              : { ...plan.data, alert_id: yield* hashAlertKey(plan.alertKey) };
          return yield* sendToDevice({
            sender: input.sender,
            device,
            data,
            alert: plan.alertKey !== null,
            aggregate: plan.nextAggregate,
          });
        }),
      { concurrency: 4 },
    );
  });

  const pruneRevokedRegistrations = Effect.gen(function* () {
    const active = new Set<string>(
      (yield* sessions.listActive()).map((session) => session.sessionId),
    );
    const stale = new Set(
      (yield* devices.list).flatMap((record) =>
        record.sessionId !== null && !active.has(record.sessionId) ? [record.sessionId] : [],
      ),
    );
    yield* Effect.forEach(stale, devices.removeForSession, { discard: true });
  }).pipe(
    Effect.mapError((cause) => new DirectPushError({ operation: "pruneRegistrations", cause })),
    Effect.withSpan("DirectPush.pruneRevokedRegistrations"),
  );

  // Registrations live as long as the pairing that made them.
  yield* sessions.streamChanges.pipe(
    Stream.filter((change) => change.type === "clientRemoved"),
    Stream.map(() => undefined),
    Stream.prepend([undefined]),
    Stream.runForEach(() =>
      pruneRevokedRegistrations.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("direct push registration cleanup failed", {
            cause: Cause.pretty(cause),
          }),
        ),
      ),
    ),
    Effect.forkScoped,
  );

  const deliveryTarget: AgentActivityDeliveryTarget = {
    name: "direct-push",
    changes: Stream.fromPubSub(changes),
    resolve: Effect.gen(function* () {
      const account = yield* resolveAccount(false);
      const current = account.loaded;
      if (current === undefined) return { _tag: "Unavailable" as const };
      return {
        _tag: "Active" as const,
        identity: `direct-push\n${current.path}\n${current.account.client_email}`,
        publish: Effect.fn("DirectPush.publish")(
          function* (publication) {
            const nowMs = (yield* DateTime.now).epochMilliseconds;
            if (publication.state === null) rows.delete(publication.threadId);
            else rows.set(publication.threadId, publication.state);
            for (const [threadId, state] of rows) {
              if (!isRetainedActivityRow(state, nowMs)) rows.delete(threadId);
            }
            const results = yield* deliver({
              sender: current.sender,
              state: publication.state,
              replay: false,
            });
            const failed = results.find((result) => result.retryable);
            // Failing retries the publication; unchanged baselines keep a retried alert.
            if (failed) return yield* Effect.fail(failed.error);
          },
          Effect.mapError(
            (cause) =>
              new AgentActivityDeliveryError({
                target: "direct-push",
                operation: "publish",
                cause,
              }),
          ),
        ),
      };
    }).pipe(
      Effect.mapError(
        (cause) =>
          new AgentActivityDeliveryError({ target: "direct-push", operation: "resolve", cause }),
      ),
    ),
  };

  const mapError = (operation: string) =>
    Effect.mapError((cause: unknown) => new DirectPushError({ operation, cause }));

  return DirectPush.of({
    deliveryTarget,
    pruneRevokedRegistrations,
    getStatus: status(true).pipe(mapError("status")),
    setServiceAccount: Effect.fn("DirectPush.setServiceAccount")(function* (path) {
      if (path === null) {
        yield* secrets.remove(DIRECT_PUSH_SERVICE_ACCOUNT_PATH_SECRET);
      } else {
        yield* secrets.set(DIRECT_PUSH_SERVICE_ACCOUNT_PATH_SECRET, new TextEncoder().encode(path));
      }
      const next = yield* status(true);
      yield* PubSub.publish(changes, undefined);
      return next;
    }, mapError("setServiceAccount")),
    registerDevice: Effect.fn("DirectPush.registerDevice")(function* (input) {
      yield* devices.upsert({
        registration: input.registration,
        sessionId: input.sessionId,
        now: DateTime.formatIso(yield* DateTime.now),
      });
      const account = yield* resolveAccount(false);
      if (account.loaded === undefined) return { configured: false };
      // Repaint this phone's card without alerting, as the relay does after registration.
      yield* deliver({
        sender: account.loaded.sender,
        state: null,
        replay: true,
        deviceId: input.registration.deviceId,
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("direct push registration replay failed", {
            cause: Cause.pretty(cause),
          }),
        ),
      );
      return { configured: true };
    }, mapError("registerDevice")),
    unregisterDevice: Effect.fn("DirectPush.unregisterDevice")(function* (deviceId) {
      yield* devices.remove(deviceId);
    }, mapError("unregisterDevice")),
    sendTest: Effect.fn("DirectPush.sendTest")(function* (deviceId) {
      const account = yield* resolveAccount(true);
      const records = (yield* devices.list).filter(
        (record) => deviceId === undefined || record.deviceId === deviceId,
      );
      const current = account.loaded;
      if (current === undefined) {
        const reason =
          account.status.status === "invalid"
            ? account.status.reason
            : "This computer has no Firebase service account yet.";
        return {
          deliveries: records.map((record) => ({
            deviceId: record.deviceId,
            label: record.label,
            ok: false,
            error: reason,
          })),
        };
      }
      const nowMs = (yield* DateTime.now).epochMilliseconds;
      const deliveries = yield* Effect.forEach(
        records,
        (device) =>
          Effect.gen(function* () {
            // Carry the current card so the test alert cannot clear an ongoing one.
            const displayed =
              device.preferences.notificationsEnabled && device.preferences.liveActivitiesEnabled
                ? makeAggregateState({
                    activeStates: [...rows.values()],
                    terminalState: null,
                    nowMs,
                  })
                : null;
            const result = yield* sendToDevice({
              sender: current.sender,
              device,
              alert: true,
              data: fitFcmData({
                t3_kind: "agent_activity",
                device_id: device.deviceId,
                user_id: DIRECT_PUSH_USER_ID,
                updated_at: String(nowMs),
                ...androidActivityData(displayed),
                alert_id: yield* random.uuidV4(),
                alert_title: `${BRAND.displayName} test notification`,
                alert_body: "Notifications from this computer reach this phone.",
                alert_path: "/",
              }),
            });
            return {
              deviceId: device.deviceId,
              label: device.label,
              ok: result.ok,
              error: result.error,
            };
          }),
        { concurrency: 4 },
      );
      return { deliveries };
    }, mapError("sendTest")),
  });
}).pipe(Effect.annotateLogs({ service: "DirectPush" }));

export const layer = Layer.effect(DirectPush, make);
