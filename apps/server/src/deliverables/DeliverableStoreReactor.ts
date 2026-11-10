import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";

import { forkParked } from "../serverActivation.ts";
import * as DeliverableService from "./DeliverableService.ts";
import * as DeliverableStoreCleanup from "./DeliverableStoreCleanup.ts";

/**
 * Finishes, at startup, what the store was asked to do and a stopped server left undone: recorded
 * decisions to delete a removed project's Work history, then a cleanup of what nothing points at.
 * A project being removed or missing is never a reason to delete anything here.
 */
export class DeliverableStoreReactor extends Context.Service<
  DeliverableStoreReactor,
  { readonly start: () => Effect.Effect<void, never, Scope.Scope> }
>()("t3/deliverables/DeliverableStoreReactor") {}

const make = Effect.gen(function* () {
  const deliverables = yield* DeliverableService.DeliverableService;
  const cleanup = yield* DeliverableStoreCleanup.DeliverableStoreCleanup;

  const start: DeliverableStoreReactor["Service"]["start"] = Effect.fn(
    "DeliverableStoreReactor.start",
  )(function* () {
    yield* forkParked(
      deliverables.resumeHistoryPurges.pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not finish deleting Work history that was asked for", {
            reason: error.reason,
          }),
        ),
        Effect.andThen(cleanup.request),
      ),
    );
  });

  return DeliverableStoreReactor.of({ start });
});

export const layer = Layer.effect(DeliverableStoreReactor, make);
