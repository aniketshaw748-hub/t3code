import type { ThreadId } from "@t3tools/contracts";
import {
  RelayApi,
  type RelayAgentActivityPublishProofPayload,
  type RelayAgentActivityState,
} from "@t3tools/contracts/relay";
import { withRelayClientTracing } from "@t3tools/shared/relayTracing";
import { normalizeRelayIssuer, RELAY_ACTIVITY_PUBLISH_TYP } from "@t3tools/shared/relayJwt";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpApiClient from "effect/http-api/HttpApiClient";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  isAgentActivityPublishingEnabledValue,
  PUBLISH_AGENT_ACTIVITY_SECRET,
  RELAY_ENVIRONMENT_CREDENTIAL_SECRET,
  RELAY_ISSUER_SECRET,
  RELAY_URL_SECRET,
} from "../cloud/config.ts";
import { EnvironmentSigningKey } from "../cloud/environmentKeys.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import {
  AgentActivityDeliveryError,
  type AgentActivityDeliveryTarget,
} from "./AgentActivityDeliveryTargets.ts";

function relayEnvironmentClient(token: string) {
  return HttpClient.mapRequest(HttpClientRequest.setHeader("authorization", `Bearer ${token}`));
}

function deliveryStats(
  deliveries: ReadonlyArray<{
    readonly ok: boolean;
    readonly queued?: boolean | undefined;
    readonly kind: string;
    readonly apnsStatus?: number | null;
    readonly apnsReason?: string | null;
  }>,
) {
  let queued = 0;
  let successful = 0;
  let failed = 0;
  const failedReasons: string[] = [];
  const kinds = new Set<string>();

  for (const delivery of deliveries) {
    kinds.add(delivery.kind);
    if (delivery.queued) {
      queued += 1;
      continue;
    }
    if (delivery.ok) {
      successful += 1;
      continue;
    }
    failed += 1;
    failedReasons.push(`${delivery.apnsStatus ?? "transport"}:${delivery.apnsReason ?? "unknown"}`);
  }

  return {
    total: deliveries.length,
    queued,
    successful,
    failed,
    kinds: [...kinds],
    failedReasons,
  };
}

const makePublishProof = Effect.fn("makePublishProof")(function* (input: {
  readonly relayIssuer: string;
  readonly environmentId: string;
  readonly threadId: ThreadId;
  readonly state: RelayAgentActivityState | null;
  readonly jti: string;
}) {
  const now = yield* DateTime.now;
  const expiresAt = DateTime.add(now, { minutes: 5 });
  const payload = {
    iss: `t3-env:${input.environmentId}`,
    aud: normalizeRelayIssuer(input.relayIssuer),
    sub: input.environmentId,
    jti: input.jti,
    iat: Math.floor(now.epochMilliseconds / 1_000),
    exp: Math.floor(expiresAt.epochMilliseconds / 1_000),
    environmentId: input.environmentId as RelayAgentActivityPublishProofPayload["environmentId"],
    threadId: input.threadId,
    state: input.state,
  } satisfies RelayAgentActivityPublishProofPayload;
  const signingKey = yield* EnvironmentSigningKey;
  return yield* signingKey.sign({ typ: RELAY_ACTIVITY_PUBLISH_TYP, payload });
});

/** Publishes agent activity to the T3 Connect relay once this environment is linked. */
export const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const random = yield* SecureRandom.SecureRandom;
  const signingKey = yield* EnvironmentSigningKey;
  const fetch = yield* FetchHttpClient.Fetch;

  const readSecretString = (name: string) =>
    secrets
      .get(name)
      .pipe(
        Effect.map((bytes) =>
          Option.isSome(bytes) ? new TextDecoder().decode(bytes.value) : null,
        ),
      );

  const readRelayConfig = Effect.gen(function* () {
    const [url, issuer, environmentCredential] = yield* Effect.all([
      readSecretString(RELAY_URL_SECRET),
      readSecretString(RELAY_ISSUER_SECRET),
      readSecretString(RELAY_ENVIRONMENT_CREDENTIAL_SECRET),
    ]);
    return url && environmentCredential
      ? { url, issuer: issuer ?? url, environmentCredential }
      : null;
  });

  const makeRelayClient = (relayConfig: {
    readonly url: string;
    readonly environmentCredential: string;
  }) =>
    HttpApiClient.make(RelayApi, {
      baseUrl: relayConfig.url,
      transformClient: relayEnvironmentClient(relayConfig.environmentCredential),
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    );

  let cachedRelayClient:
    | {
        readonly identity: string;
        readonly client: Effect.Success<ReturnType<typeof makeRelayClient>>;
      }
    | undefined;

  const target: AgentActivityDeliveryTarget = {
    name: "relay",
    // T3 Connect enables publication from its own process; the catch-up retry notices it.
    changes: Stream.empty,
    resolve: Effect.gen(function* () {
      if (
        !isAgentActivityPublishingEnabledValue(
          yield* readSecretString(PUBLISH_AGENT_ACTIVITY_SECRET),
        )
      ) {
        // Unlinked environments never enable publication, so they back off like an absent link.
        return (yield* readSecretString(RELAY_URL_SECRET))
          ? { _tag: "Disabled" as const }
          : { _tag: "Unavailable" as const };
      }
      const relayConfig = yield* readRelayConfig;
      if (!relayConfig) return { _tag: "Unavailable" as const };
      const identity = [
        "relay",
        relayConfig.url,
        relayConfig.issuer,
        relayConfig.environmentCredential,
      ].join("\n");
      return {
        _tag: "Active" as const,
        identity,
        publish: Effect.fn("relay.agent_activity.publish")(
          function* (publication) {
            const environmentId = yield* serverEnvironment.getEnvironmentId;
            if (cachedRelayClient?.identity !== identity) {
              cachedRelayClient = { identity, client: yield* makeRelayClient(relayConfig) };
            }
            const relayClient = cachedRelayClient.client;
            const proof = yield* makePublishProof({
              relayIssuer: relayConfig.issuer,
              environmentId,
              threadId: publication.threadId,
              state: publication.state,
              jti: yield* random.uuidV4(),
            }).pipe(Effect.provideService(EnvironmentSigningKey, signingKey));
            const response = yield* relayClient.server
              .publishAgentActivity({
                params: { environmentId, threadId: publication.threadId },
                payload: { state: publication.state, proof },
              })
              .pipe(Effect.timeout("10 seconds"));
            yield* Effect.logInfo("agent activity publish completed", {
              environmentId,
              threadId: publication.threadId,
              ok: response.ok,
              deliveries: deliveryStats(response.deliveries),
            });
          },
          withRelayClientTracing,
          Effect.mapError(
            (cause) =>
              new AgentActivityDeliveryError({ target: "relay", operation: "publish", cause }),
          ),
        ),
      };
    }).pipe(
      Effect.mapError(
        (cause) => new AgentActivityDeliveryError({ target: "relay", operation: "resolve", cause }),
      ),
    ),
  };
  return target;
});
