import {
  ChatAttachmentId,
  type ChatImageAttachment,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import {
  chatAttachmentStableKey,
  createDeterministicAttachmentId,
  resolveAttachmentPath,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as TurnContextNotes from "../orchestration-v2/TurnContextNotes.ts";
import * as DeliverableNoteRepository from "../persistence/DeliverableNotes.ts";
import * as DeliverableRepository from "../persistence/Deliverables.ts";
import * as DeliverableBlobStore from "./DeliverableBlobStore.ts";

const ACTION_WORDS = { undo: "undone", redo: "redone", restore: "restored" } as const;

/** One line per file, for the latest version the user moved it to. */
function restoreNote(
  restores: ReadonlyArray<{
    readonly action: "undo" | "redo" | "restore";
    readonly path: string;
    readonly ordinal: number;
  }>,
): string | null {
  if (restores.length === 0) return null;
  const latest = new Map(restores.map((restore) => [restore.path, restore]));
  const lines = [...latest.values()].map(
    (restore) =>
      `- ${restore.path} was ${ACTION_WORDS[restore.action]} to V${restore.ordinal}; it and the sources that changed with it now match V${restore.ordinal}.`,
  );
  return `Since your last turn, deliverables moved to other versions:\n${lines.join("\n")}\nWork from these files, not from what you last wrote.`;
}

/**
 * How a Work project's files are versioned, before every turn: the app records each save of a
 * deliverable as its next version, so a revision saved as a copy breaks the version history.
 */
export function workProjectInstructions(paths: ReadonlyArray<string>): string {
  const files =
    paths.length === 0
      ? "Save each deliverable (a deck, video, image or PDF) as one file in this project."
      : `This project's deliverables: ${paths.join(", ")}.`;
  return [
    "Work project: this app versions deliverables itself. Every time a turn saves a deliverable, it records the file as its next version (V1, V2, V3) that the user can compare and undo.",
    `- ${files}`,
    "- To revise one, rebuild it and overwrite the same path. Never save a revision as a new file such as name-v2, name (2) or name_final.",
    "- Keep the sources you generate it from (for example build-deck.cjs) in the project, and edit them for the next revision.",
    "- When a message lists notes with ids, fix them in the file, then call deliverable_mark_notes_fixed with those ids, a one-line reply, and checkAt pointing at the change (for example {kind:'slide',index:1}).",
  ].join("\n");
}

/**
 * Tells a Work project's turns how versions work and which versions the user undid or restored,
 * and gives a message the pictures of the notes sent in it.
 */
export const layer = Layer.effect(
  TurnContextNotes.TurnContextNotes,
  Effect.gen(function* () {
    const repository = yield* DeliverableRepository.DeliverableRepository;
    const noteRepository = yield* DeliverableNoteRepository.DeliverableNoteRepository;
    const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;
    const config = yield* ServerConfig.ServerConfig;
    const projects = yield* ProjectStore.ProjectStoreV2;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    /**
     * A note's stored picture as a chat attachment of the thread. The same picture in the same
     * message keeps its id, so a turn that starts again reuses the file.
     */
    const noteAttachment = Effect.fn("DeliverableTurnNotes.noteAttachment")(function* (input: {
      readonly threadId: string;
      readonly messageId: string;
      readonly index: number;
      readonly snapshotPath: string;
    }) {
      const bytes = yield* fileSystem.readFile(
        path.join(blobs.root, ...input.snapshotPath.split("/")),
      );
      const id = createDeterministicAttachmentId(
        input.threadId,
        chatAttachmentStableKey(`${input.messageId}:note`, input.index, bytes),
      );
      if (id === null || bytes.byteLength > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) return [];
      const attachment = {
        type: "image",
        id: ChatAttachmentId.make(id),
        name: `note-${input.index + 1}.png`,
        mimeType: "image/png",
        sizeBytes: bytes.byteLength,
      } satisfies ChatImageAttachment;
      const target = resolveAttachmentPath({ attachmentsDir: config.attachmentsDir, attachment });
      if (target === null) return [];
      yield* fileSystem.writeFile(target, bytes);
      return [attachment];
    });

    const instructions = Effect.fn("DeliverableTurnNotes.instructions")(function* (
      projectId: ProjectId,
    ) {
      const project = yield* projects.get(projectId).pipe(Effect.orElseSucceed(Option.none));
      if (Option.isNone(project) || project.value.kind !== "work") return [];
      const deliverables = yield* repository
        .listDeliverables(projectId)
        .pipe(Effect.orElseSucceed(() => []));
      return [
        workProjectInstructions(
          deliverables
            .filter((deliverable) => deliverable.strayVersionOf == null)
            .map((deliverable) => deliverable.path),
        ),
      ];
    });

    return TurnContextNotes.TurnContextNotes.of({
      since: Effect.fn("DeliverableTurnNotes.since")(function* (input) {
        const restores = yield* repository.listRestoresSince(input).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not read deliverable restores for the next turn", {
              operation: error.operation,
            }).pipe(Effect.as([])),
          ),
        );
        const note = restoreNote(restores);
        return [...(yield* instructions(input.projectId)), ...(note === null ? [] : [note])];
      }),
      attachments: Effect.fn("DeliverableTurnNotes.attachments")(function* (input) {
        const sent = yield* noteRepository
          .listNotesSentIn(input.messageId)
          .pipe(Effect.orElseSucceed(() => []));
        const pictures = yield* Effect.forEach(
          sent.flatMap((note) => (note.snapshotPath === null ? [] : [note.snapshotPath])),
          (snapshotPath, index) =>
            noteAttachment({ ...input, index, snapshotPath }).pipe(
              // The note's words still reach the agent when its picture cannot be read.
              Effect.catch((error) =>
                Effect.as(
                  Effect.logWarning("Could not attach a note's picture to its message", {
                    error: error.message,
                  }),
                  [],
                ),
              ),
            ),
        );
        return pictures.flat();
      }),
    });
  }),
);
