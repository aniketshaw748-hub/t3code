import type { ApplicationStoredEvent, ProjectId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import { forkParked } from "../serverActivation.ts";
import * as DeliverableService from "./DeliverableService.ts";
import * as DeliverableStoreCleanup from "./DeliverableStoreCleanup.ts";

/**
 * Keeps Work mode's records in step with projects: when a project is deleted its deliverables go
 * with it, and what they kept in the store is cleaned out. Starting it also catches up on
 * deletions made while the server was stopped and on anything a crash left in the store.
 */
export class DeliverableStoreReactor extends Context.Service<
  DeliverableStoreReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/deliverables/DeliverableStoreReactor") {}

const deletedProject = (event: ApplicationStoredEvent): ProjectId | null =>
  "type" in event && event.type === "project.deleted" ? event.payload.projectId : null;

const make = Effect.gen(function* () {
  const events = yield* OrchestrationEventStore.OrchestrationEventStore;
  const deliverables = yield* DeliverableService.DeliverableService;
  const cleanup = yield* DeliverableStoreCleanup.DeliverableStoreCleanup;

  const worker = yield* makeDrainableWorker((projectId: ProjectId | "catch-up") =>
    (projectId === "catch-up"
      ? Effect.andThen(deliverables.removeDeletedProjects, cleanup.request)
      : deliverables.removeProject(projectId)
    ).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not remove a deleted project's deliverables", {
          projectId,
          reason: error.reason,
        }),
      ),
    ),
  );

  const start: DeliverableStoreReactor["Service"]["start"] = Effect.fn(
    "DeliverableStoreReactor.start",
  )(function* () {
    yield* forkParked(
      Effect.gen(function* () {
        // Deletions before this point are found by the catch-up, which reads the projects.
        const afterSequence = yield* events.latestApplicationSequence;
        yield* worker.enqueue("catch-up");
        yield* Stream.runForEach(
          events.streamProjectedApplicationEvents({
            afterSequence,
            filter: (event) => deletedProject(event) !== null,
            project: (event) => ({ sequence: event.sequence, projectId: deletedProject(event) }),
          }),
          (event) => (event.projectId === null ? Effect.void : worker.enqueue(event.projectId)),
        );
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Stopped watching for deleted projects", { error: error.message }),
        ),
      ),
    );
  });

  return DeliverableStoreReactor.of({ start, drain: worker.drain });
});

export const layer = Layer.effect(DeliverableStoreReactor, make);
