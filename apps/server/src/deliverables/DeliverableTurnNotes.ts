import type { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
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

/** Tells a Work project's turns how versions work, and which versions the user undid or restored. */
export const layer = Layer.effect(
  TurnContextNotes.TurnContextNotes,
  Effect.gen(function* () {
    const repository = yield* DeliverableRepository.DeliverableRepository;
    const projects = yield* ProjectStore.ProjectStoreV2;

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
    });
  }),
);
