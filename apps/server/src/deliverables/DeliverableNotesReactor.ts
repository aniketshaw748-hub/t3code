import type { MessageId, ProjectId, RunId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { forkParked } from "../serverActivation.ts";
import * as DeliverableNotes from "./DeliverableNotes.ts";
import * as WorkProjectEvents from "./WorkProjectEvents.ts";

type Job =
  | { readonly type: "link"; readonly messageId: MessageId; readonly runId: RunId }
  | {
      readonly type: "settle";
      readonly projectId: ProjectId | null;
      readonly runId: RunId;
      readonly final: boolean;
    };

const ENDED_WITHOUT_TURN = new Set(["failed", "cancelled", "interrupted"]);

/** Keeps notes in step with the runs that work on them and the versions those runs make. */
export class DeliverableNotesReactor extends Context.Service<
  DeliverableNotesReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/deliverables/DeliverableNotesReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const notes = yield* DeliverableNotes.DeliverableNotes;
  const events = yield* WorkProjectEvents.WorkProjectEvents;

  const settle = (projectId: ProjectId, runId: RunId, final: boolean) =>
    notes.settleRun({ projectId, runId, final });

  // One job at a time, so a run's link always lands before its versions settle it.
  const worker = yield* makeDrainableWorker((job: Job) =>
    (job.type === "link"
      ? notes.linkRun(job)
      : job.projectId !== null
        ? settle(job.projectId, job.runId, job.final)
        : notes.projectsForRun(job.runId).pipe(
            Effect.flatMap((projects) =>
              Effect.forEach(projects, (projectId) => settle(projectId, job.runId, job.final), {
                discard: true,
              }),
            ),
          )
    ).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not update notes for a run", {
          job: job.type,
          reason: error.reason,
        }),
      ),
    ),
  );

  const start: DeliverableNotesReactor["Service"]["start"] = Effect.fn(
    "DeliverableNotesReactor.start",
  )(function* () {
    yield* forkParked(
      Stream.runForEach(events.events, (event) => {
        switch (event.type) {
          case "version-recorded":
            return event.version.source.runId === undefined
              ? Effect.void
              : worker.enqueue({
                  type: "settle",
                  projectId: event.projectId,
                  runId: event.version.source.runId,
                  final: false,
                });
          case "turn-settled":
            return worker.enqueue({
              type: "settle",
              projectId: event.projectId,
              runId: event.runId,
              final: true,
            });
          case "changed":
            return Effect.void;
        }
      }),
    );
    yield* forkParked(
      // Runs for every domain event; only run creation and runs ending early do any work.
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        event.type === "run.created"
          ? worker.enqueue({
              type: "link",
              messageId: event.payload.userMessageId,
              runId: event.payload.id,
            })
          : event.type === "run.updated" && ENDED_WITHOUT_TURN.has(event.payload.status)
            ? worker.enqueue({
                type: "settle",
                projectId: null,
                runId: event.payload.id,
                final: true,
              })
            : Effect.void,
      ),
    );
  });

  return DeliverableNotesReactor.of({ start, drain: worker.drain });
});

export const layer = Layer.effect(DeliverableNotesReactor, make);
