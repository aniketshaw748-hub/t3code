import type { DeliverableVersion, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

export type WorkProjectEvent =
  /** Deliverables, renditions, notes or review status of the project changed. */
  | { readonly type: "changed"; readonly projectId: ProjectId }
  | {
      readonly type: "version-recorded";
      readonly projectId: ProjectId;
      readonly version: DeliverableVersion;
    }
  /** A turn's checkpoint was turned into versions; `versions` may be empty. */
  | {
      readonly type: "turn-settled";
      readonly projectId: ProjectId;
      readonly threadId: ThreadId;
      readonly runId: RunId;
      readonly versions: ReadonlyArray<DeliverableVersion>;
    };

/** In-process fan-out of Work-mode changes, for live project views and note bookkeeping. */
export class WorkProjectEvents extends Context.Service<
  WorkProjectEvents,
  {
    readonly publish: (event: WorkProjectEvent) => Effect.Effect<void>;
    readonly events: Stream.Stream<WorkProjectEvent>;
  }
>()("t3/deliverables/WorkProjectEvents") {}

export const layer = Layer.effect(
  WorkProjectEvents,
  Effect.gen(function* () {
    const pubsub = yield* PubSub.unbounded<WorkProjectEvent>();
    return WorkProjectEvents.of({
      // Untraced: one per change, inside operations that already have spans.
      publish: Effect.fnUntraced(function* (event) {
        yield* PubSub.publish(pubsub, event);
      }),
      events: Stream.fromPubSub(pubsub),
    });
  }),
);
