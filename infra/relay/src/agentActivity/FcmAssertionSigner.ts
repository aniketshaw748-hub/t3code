import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { signFcmAssertion, type FcmAssertionInput } from "@t3tools/shared/fcm";

import * as WebCrypto from "../WebCrypto.ts";

export class FcmAssertionSigningError extends Schema.TaggedError<FcmAssertionSigningError>()(
  "FcmAssertionSigningError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return "Failed to sign Firebase authorization assertion.";
  }
}

export class FcmAssertionSigner extends Context.Service<
  FcmAssertionSigner,
  {
    readonly sign: (input: FcmAssertionInput) => Effect.Effect<string, FcmAssertionSigningError>;
  }
>()("t3code-relay/agentActivity/FcmAssertionSigner") {}

const make = Effect.gen(function* () {
  const { subtle } = yield* WebCrypto.WebCrypto;
  return FcmAssertionSigner.of({
    sign: Effect.fn("relay.fcm.assertion")(function* (input) {
      return yield* Effect.tryPromise({
        try: () => signFcmAssertion(subtle, input),
        catch: (cause) => new FcmAssertionSigningError({ cause }),
      });
    }),
  });
});
export const layer = Layer.effect(FcmAssertionSigner, make);
