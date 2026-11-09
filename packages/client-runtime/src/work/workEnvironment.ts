import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

/** Work mode's live project data and the commands that change it, for web and mobile. */
export function createWorkEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  // Edits of one deliverable's history take turns; a second undo waits for the first.
  const historyConcurrency = {
    mode: "serial" as const,
    key: ({ environmentId, input }: { environmentId: string; input: { deliverableId: string } }) =>
      JSON.stringify([environmentId, input.deliverableId]),
  };
  return {
    projectSnapshot: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:work:project",
      tag: WS_METHODS.workSubscribeProject,
    }),
    rendition: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:work:rendition",
      tag: WS_METHODS.deliverablesRendition,
      // Signed rendition URLs last an hour; refetch well before they lapse.
      staleTimeMs: 30 * 60_000,
    }),
    compare: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:work:compare",
      tag: WS_METHODS.deliverablesCompare,
    }),
    undo: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:work:undo",
      tag: WS_METHODS.deliverablesUndo,
      concurrency: historyConcurrency,
    }),
    redo: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:work:redo",
      tag: WS_METHODS.deliverablesRedo,
      concurrency: historyConcurrency,
    }),
    restore: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:work:restore",
      tag: WS_METHODS.deliverablesRestore,
      concurrency: historyConcurrency,
    }),
    resolveStray: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:work:resolve-stray",
      tag: WS_METHODS.deliverablesResolveStray,
      concurrency: historyConcurrency,
    }),
    createNote: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:work:create-note",
      tag: WS_METHODS.deliverableNotesCreate,
    }),
    markNotesSent: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:work:mark-notes-sent",
      tag: WS_METHODS.deliverableNotesMarkSent,
    }),
    setNoteStatus: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:work:set-note-status",
      tag: WS_METHODS.deliverableNotesSetStatus,
    }),
    deleteNote: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:work:delete-note",
      tag: WS_METHODS.deliverableNotesDelete,
    }),
  };
}
