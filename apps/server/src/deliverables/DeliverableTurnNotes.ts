import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as TurnContextNotes from "../orchestration-v2/TurnContextNotes.ts";
import * as DeliverableRepository from "../persistence/Deliverables.ts";

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

/** Tells a thread's next turn which deliverable versions the user undid or restored. */
export const layer = Layer.effect(
  TurnContextNotes.TurnContextNotes,
  Effect.gen(function* () {
    const repository = yield* DeliverableRepository.DeliverableRepository;
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
        return note === null ? [] : [note];
      }),
    });
  }),
);
