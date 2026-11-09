import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import {
  decodeFcmServiceAccountJson,
  makeFcmSender,
  type FcmClientError,
  type FcmSendInput,
} from "@t3tools/shared/fcm";

import * as RelayConfiguration from "../Config.ts";
import * as FcmAssertionSigner from "./FcmAssertionSigner.ts";

export { FcmClientError } from "@t3tools/shared/fcm";

export class FcmClient extends Context.Service<
  FcmClient,
  {
    readonly send: (
      input: FcmSendInput,
    ) => Effect.Effect<{ readonly unregistered: boolean }, FcmClientError>;
  }
>()("t3code-relay/agentActivity/FcmClient") {}

const make = Effect.gen(function* () {
  const config = yield* RelayConfiguration.RelayConfiguration;
  const signer = yield* FcmAssertionSigner.FcmAssertionSigner;
  const account = config.fcmServiceAccount
    ? Option.getOrNull(decodeFcmServiceAccountJson(Redacted.value(config.fcmServiceAccount)))
    : null;
  return FcmClient.of(yield* makeFcmSender({ account, signAssertion: signer.sign }));
});

export const layer = Layer.effect(FcmClient, make);
