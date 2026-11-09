// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no generateKeyPairSync.
import * as NodeCrypto from "node:crypto";
import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  AuthSessionId,
  DIRECT_PUSH_USER_ID,
  EnvironmentId,
  ThreadId,
  type DirectPushDeviceRegistrationInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as DirectPushDevices from "../persistence/DirectPushDevices.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as DirectPush from "./DirectPush.ts";

const { privateKey } = NodeCrypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const SERVICE_ACCOUNT = encodeJson({
  type: "service_account",
  project_id: "kavyaan-test",
  client_email: "push@kavyaan-test.iam.gserviceaccount.com",
  private_key: privateKey,
});
const unused = () => Effect.die("unused");

function registration(
  deviceId: string,
  pushToken: string,
  overrides: Partial<DirectPushDeviceRegistrationInput> = {},
): DirectPushDeviceRegistrationInput {
  return {
    deviceId,
    label: `Phone ${deviceId}`,
    platform: "android",
    androidApiLevel: 35,
    packageName: "dev.kavyaan.app",
    pushToken,
    preferences: {
      liveActivitiesEnabled: true,
      notificationsEnabled: true,
      notifyOnApproval: true,
      notifyOnInput: true,
      notifyOnCompletion: true,
      notifyOnFailure: true,
    },
    ...overrides,
  };
}

interface SentMessage {
  readonly token: string;
  readonly data: Record<string, string>;
}

const makeHarness = Effect.fnUntraced(function* (
  options: {
    readonly fcmResponse?: (message: SentMessage) => Response;
  } = {},
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "direct-push-test-" });
  const accountPath = `${directory}/firebase-service-account.json`;
  yield* fileSystem.writeFileString(accountPath, SERVICE_ACCOUNT);
  const appConfigPath = `${directory}/google-services.json`;
  yield* fileSystem.writeFileString(appConfigPath, encodeJson({ project_info: {} }));

  const values = new Map<string, Uint8Array>();
  const secrets = ServerSecretStore.ServerSecretStore.of({
    get: (name) => Effect.sync(() => Option.fromUndefinedOr(values.get(name))),
    create: (name, value) => Effect.sync(() => void values.set(name, value)),
    set: (name, value) => Effect.sync(() => void values.set(name, value)),
    remove: (name) => Effect.sync(() => void values.delete(name)),
    getOrCreateRandom: unused,
  });
  const activeSessions = yield* Ref.make<ReadonlyArray<string>>(["session-1", "session-2"]);
  const sessionChanges = yield* PubSub.unbounded<SessionStore.SessionCredentialChange>();
  const sessions = {
    listActive: () =>
      Ref.get(activeSessions).pipe(
        Effect.map((ids) => ids.map((id) => ({ sessionId: AuthSessionId.make(id) }) as never)),
      ),
    streamChanges: Stream.fromPubSub(sessionChanges),
  } as unknown as SessionStore.SessionStore["Service"];

  const sent: SentMessage[] = [];
  const fetch: typeof globalThis.fetch = Object.assign(
    (
      input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Promise.resolve(Response.json({ access_token: "google-token" }));
      }
      const body = init?.body;
      const text = typeof body === "string" ? body : new TextDecoder().decode(body as Uint8Array);
      const { message } = decodeJson(text) as { message: SentMessage };
      sent.push(message);
      return Promise.resolve(options.fcmResponse?.(message) ?? Response.json({ name: "ok" }));
    },
    { preconnect: () => {} },
  );

  const directPush = yield* DirectPush.make.pipe(
    Effect.provideService(ServerSecretStore.ServerSecretStore, secrets),
    Effect.provideService(SessionStore.SessionStore, sessions),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
  );
  return {
    directPush,
    accountPath,
    appConfigPath,
    sent,
    activeSessions,
  };
});

const layerTest = Layer.mergeAll(
  DirectPushDevices.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
).pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCryptoLayer.layer)));

const running = {
  environmentId: EnvironmentId.make("env"),
  threadId: ThreadId.make("thread"),
  projectTitle: "Project",
  threadTitle: "Fix the build",
  modelTitle: "Haiku",
  headline: "Working",
  phase: "running" as const,
  // it.effect runs on a TestClock that starts at the epoch.
  updatedAt: "1970-01-01T00:00:00.000Z",
  deepLink: "/threads/env/thread",
};

describe("DirectPush", () => {
  it.effect("reports a missing, wrong or valid service account", () =>
    Effect.gen(function* () {
      const { directPush, accountPath, appConfigPath } = yield* makeHarness();
      assert.deepStrictEqual((yield* directPush.getStatus).serviceAccount, {
        status: "not-configured",
      });
      const wrong = yield* directPush.setServiceAccount(appConfigPath);
      assert.equal(wrong.serviceAccount.status, "invalid");
      const right = yield* directPush.setServiceAccount(accountPath);
      assert.deepStrictEqual(right.serviceAccount, {
        status: "configured",
        path: accountPath,
        projectId: "kavyaan-test",
        clientEmail: "push@kavyaan-test.iam.gserviceaccount.com",
      });
      assert.equal((yield* directPush.deliveryTarget.resolve)._tag, "Active");
      assert.equal(
        (yield* directPush.setServiceAccount(null)).serviceAccount.status,
        "not-configured",
      );
      assert.equal((yield* directPush.deliveryTarget.resolve)._tag, "Unavailable");
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("moves a reused token to the newest device and forgets UNREGISTERED tokens", () =>
    Effect.gen(function* () {
      let unregistered = false;
      const harness = yield* makeHarness({
        fcmResponse: () =>
          unregistered
            ? Response.json(
                {
                  error: {
                    status: "NOT_FOUND",
                    details: [
                      {
                        "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
                        errorCode: "UNREGISTERED",
                      },
                    ],
                  },
                },
                { status: 404 },
              )
            : Response.json({ name: "ok" }),
      });
      const { directPush, sent } = harness;
      assert.deepStrictEqual(
        yield* directPush.registerDevice({
          registration: registration("a", "token-1"),
          sessionId: "session-1",
        }),
        { configured: false },
      );
      yield* directPush.setServiceAccount(harness.accountPath);
      yield* directPush.registerDevice({
        registration: registration("b", "token-1"),
        sessionId: "session-2",
      });
      assert.deepStrictEqual(
        (yield* directPush.getStatus).devices.map((device) => device.deviceId),
        ["b"],
      );
      // Registration replays the current card to the new device without alerting.
      assert.equal(sent.length, 1);
      assert.isUndefined(sent[0]?.data.alert_id);

      const target = yield* directPush.deliveryTarget.resolve;
      assert(target._tag === "Active");
      yield* target.publish({
        threadId: running.threadId,
        projectId: "project",
        state: running,
        reason: "snapshot",
      });
      assert.equal(sent.length, 2);
      assert.include(sent[1]?.data, {
        device_id: "b",
        user_id: DIRECT_PUSH_USER_ID,
        active: "true",
        t3_kind: "agent_activity",
      });
      assert.equal(sent[1]?.token, "token-1");
      const delivered = (yield* directPush.getStatus).devices[0]?.lastDelivery;
      assert.equal(delivered?.ok, true);

      unregistered = true;
      yield* target.publish({
        threadId: running.threadId,
        projectId: "project",
        state: { ...running, phase: "completed" },
        reason: "snapshot",
      });
      assert.deepStrictEqual((yield* directPush.getStatus).devices, []);
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("sends a test alert and records a failed delivery", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        fcmResponse: (message) =>
          message.token === "bad-token"
            ? Response.json({ error: { status: "PERMISSION_DENIED" } }, { status: 403 })
            : Response.json({ name: "ok" }),
      });
      const { directPush } = harness;
      yield* directPush.setServiceAccount(harness.accountPath);
      yield* directPush.registerDevice({
        registration: registration("good", "good-token"),
        sessionId: "session-1",
      });
      yield* directPush.registerDevice({
        registration: registration("bad", "bad-token"),
        sessionId: "session-1",
      });
      const result = yield* directPush.sendTest(undefined);
      assert.deepStrictEqual(
        result.deliveries.map((delivery) => [delivery.deviceId, delivery.ok]),
        [
          ["good", true],
          ["bad", false],
        ],
      );
      assert.include(result.deliveries[1]?.error ?? "", "PERMISSION_DENIED");
      const test = harness.sent.at(-2);
      assert.equal(test?.data.alert_title, "Kavyaan test notification");
      const status = yield* directPush.getStatus;
      assert.equal(
        status.devices.find((device) => device.deviceId === "bad")?.lastDelivery?.ok,
        false,
      );
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );

  it.effect("forgets phones whose pairing was revoked", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const { directPush } = harness;
      yield* directPush.registerDevice({
        registration: registration("kept", "token-kept"),
        sessionId: "session-1",
      });
      yield* directPush.registerDevice({
        registration: registration("revoked", "token-revoked"),
        sessionId: "session-2",
      });
      yield* Ref.update(harness.activeSessions, (ids) => ids.filter((id) => id !== "session-2"));
      yield* directPush.pruneRevokedRegistrations;
      assert.deepStrictEqual(
        (yield* directPush.getStatus).devices.map((device) => device.deviceId),
        ["kept"],
      );
      yield* directPush.unregisterDevice("kept");
      assert.deepStrictEqual((yield* directPush.getStatus).devices, []);
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
  );
});
