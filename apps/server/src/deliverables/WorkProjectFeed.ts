import {
  type DeliverableError,
  DeliverableNoteError,
  type ProjectId,
  type WorkProjectSnapshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as DeliverableNotes from "./DeliverableNotes.ts";
import * as DeliverableService from "./DeliverableService.ts";
import * as WorkProjectEvents from "./WorkProjectEvents.ts";

// Rendering and note updates arrive in bursts; one snapshot per burst is enough.
const SNAPSHOT_DEBOUNCE = Duration.millis(120);

const fromDeliverableError = (error: DeliverableError) =>
  new DeliverableNoteError({
    reason: error.reason === "project_not_found" ? "project_not_found" : "persistence_failed",
    cause: error,
  });

/** One Work project's deliverables, versions, posters, notes and review status, kept live. */
export class WorkProjectFeed extends Context.Service<
  WorkProjectFeed,
  {
    readonly snapshot: (
      projectId: ProjectId,
    ) => Effect.Effect<WorkProjectSnapshot, DeliverableNoteError>;
    readonly subscribe: (
      projectId: ProjectId,
    ) => Stream.Stream<WorkProjectSnapshot, DeliverableNoteError>;
  }
>()("t3/deliverables/WorkProjectFeed") {}

const make = Effect.gen(function* () {
  const deliverables = yield* DeliverableService.DeliverableService;
  const notes = yield* DeliverableNotes.DeliverableNotes;
  const events = yield* WorkProjectEvents.WorkProjectEvents;

  const snapshot: WorkProjectFeed["Service"]["snapshot"] = Effect.fn("WorkProjectFeed.snapshot")(
    function* (projectId) {
      const list = yield* deliverables.list(projectId).pipe(Effect.mapError(fromDeliverableError));
      const versions = yield* Effect.forEach(list, (deliverable) =>
        deliverables.versions(deliverable.id).pipe(
          Effect.map((result) => result.versions),
          Effect.mapError(fromDeliverableError),
        ),
      );
      const posters = yield* Effect.forEach(
        list.flatMap((deliverable) =>
          deliverable.currentVersionId === null ? [] : [deliverable.currentVersionId],
        ),
        (versionId) =>
          deliverables.rendition(versionId).pipe(
            Effect.map((rendition) =>
              rendition.posterUrl === null ? [] : [{ versionId, url: rendition.posterUrl }],
            ),
            Effect.orElseSucceed(() => []),
          ),
      );
      return {
        projectId,
        deliverables: list,
        versions: versions.flat(),
        posters: posters.flat(),
        notes: yield* notes.list(projectId),
        reviews: yield* notes.listReviews(projectId),
      } satisfies WorkProjectSnapshot;
    },
  );

  const subscribe: WorkProjectFeed["Service"]["subscribe"] = (projectId) =>
    Stream.merge(
      Stream.make(projectId),
      events.events.pipe(
        Stream.filter((event) => event.type === "changed" && event.projectId === projectId),
      ),
    ).pipe(
      Stream.debounce(SNAPSHOT_DEBOUNCE),
      Stream.mapEffect(() => snapshot(projectId)),
    );

  return WorkProjectFeed.of({ snapshot, subscribe });
});

export const layer = Layer.effect(WorkProjectFeed, make);
