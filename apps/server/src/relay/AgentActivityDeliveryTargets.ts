import type { ThreadId } from "@t3tools/contracts";
import type { RelayAgentActivityState } from "@t3tools/contracts/relay";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Stream from "effect/Stream";

export interface AgentActivityPublication {
  readonly threadId: ThreadId;
  readonly projectId: string | null;
  readonly state: RelayAgentActivityState | null;
  readonly reason: string;
}

export class AgentActivityDeliveryError extends Schema.TaggedError<AgentActivityDeliveryError>()(
  "AgentActivityDeliveryError",
  {
    target: Schema.String,
    operation: Schema.Literals(["resolve", "publish"]),
    cause: Schema.Defect(),
  },
) {
  override get message() {
    return `Agent activity ${this.operation} failed for the ${this.target} target.`;
  }
}

/**
 * `Active` targets receive publications. `identity` names the target's current configuration:
 * when the joined identity of active targets changes, every thread is published again.
 * `Disabled` keeps the fast catch-up retry (another process may enable it); `Unavailable` backs off.
 */
export type AgentActivityTargetResolution =
  | {
      readonly _tag: "Active";
      readonly identity: string;
      readonly publish: (
        publication: AgentActivityPublication,
      ) => Effect.Effect<void, AgentActivityDeliveryError>;
    }
  | { readonly _tag: "Disabled" }
  | { readonly _tag: "Unavailable" };

export interface AgentActivityDeliveryTarget {
  readonly name: string;
  readonly resolve: Effect.Effect<AgentActivityTargetResolution, AgentActivityDeliveryError>;
  /** Emits when the target may have become active, so current work catches up without backoff. */
  readonly changes: Stream.Stream<void>;
}

/** Where agent activity goes: the T3 Connect relay, this host's own FCM sender, or both. */
export class AgentActivityDeliveryTargets extends Context.Service<
  AgentActivityDeliveryTargets,
  { readonly targets: ReadonlyArray<AgentActivityDeliveryTarget> }
>()("t3/relay/AgentActivityDeliveryTargets") {}
