import type { OrchestrationV2Checkpoint, ThreadId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { forkParked } from "../serverActivation.ts";
import * as DeliverableService from "./DeliverableService.ts";

/** Turns each captured turn checkpoint into deliverable versions, off the event stream's path. */
export class DeliverableCheckpointReactor extends Context.Service<
  DeliverableCheckpointReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/deliverables/DeliverableCheckpointReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const deliverables = yield* DeliverableService.DeliverableService;

  const worker = yield* makeDrainableWorker(
    (input: { readonly threadId: ThreadId; readonly checkpoint: OrchestrationV2Checkpoint }) =>
      deliverables.detectFromCheckpoint(input).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not record deliverable versions from a checkpoint", {
            threadId: input.threadId,
            checkpointId: input.checkpoint.id,
            reason: error.reason,
          }),
        ),
      ),
  );

  const start: DeliverableCheckpointReactor["Service"]["start"] = Effect.fn(
    "DeliverableCheckpointReactor.start",
  )(function* () {
    yield* forkParked(
      // Runs for every domain event; only turn checkpoints with a run do any work.
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        event.type === "checkpoint.captured" &&
        event.payload.status === "ready" &&
        event.payload.runId !== null
          ? worker.enqueue({ threadId: event.threadId, checkpoint: event.payload })
          : Effect.void,
      ),
    );
  });

  return DeliverableCheckpointReactor.of({ start, drain: worker.drain });
});

export const layer = Layer.effect(DeliverableCheckpointReactor, make);
