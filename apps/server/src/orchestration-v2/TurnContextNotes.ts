import type { ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as DateTime from "effect/DateTime";
import type * as Effect from "effect/Effect";

/**
 * Notes other features put before a thread's next prompt: standing rules for the project, such
 * as how Work projects version files, and changes made outside its turns, such as files the
 * user restored to an earlier version. Optional: turns start without it.
 */
export class TurnContextNotes extends Context.Service<
  TurnContextNotes,
  {
    /** Standing rules first, then notes for changes in the project after `since`, oldest first. */
    readonly since: (input: {
      readonly projectId: ProjectId;
      readonly since: DateTime.Utc;
    }) => Effect.Effect<ReadonlyArray<string>>;
  }
>()("t3/orchestration-v2/TurnContextNotes") {}
