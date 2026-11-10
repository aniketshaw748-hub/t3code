import type { ChatAttachment, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
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
    /**
     * Pictures to give the agent with a message beside the ones the user attached, such as what
     * the Work notes sent in it point at. Each is already a file in the attachment store.
     */
    readonly attachments: (input: {
      readonly threadId: ThreadId;
      readonly messageId: MessageId;
    }) => Effect.Effect<ReadonlyArray<ChatAttachment>>;
  }
>()("t3/orchestration-v2/TurnContextNotes") {}
