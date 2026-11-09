import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { WorkStarter } from "@t3tools/client-runtime/work/starters";
import {
  MessageId,
  ThreadId,
  type Deliverable,
  type DeliverableNote,
  type DeliverableVersion,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { formatNotesMessage } from "@t3tools/shared/deliverableNotes";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import * as Dialog from "../../components/ui/Dialog";
import { uuidv4 } from "../../lib/uuid";
import { appAtomRegistry } from "../../state/atom-registry";
import { waitForProject } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { environmentServerConfigsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { workEnvironment } from "../../state/work";
import { scheduledTaskDefaultModel } from "../settings/scheduledTaskDraft";

function alertFailure(
  title: string,
  result: Extract<AtomCommandResult<unknown, unknown>, { readonly _tag: "Failure" }>,
) {
  if (isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  Dialog.alert(
    title,
    error instanceof Error && error.message.trim().length > 0 ? error.message : "Something failed.",
  );
}

export interface WorkMessage {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** The project's Work thread; null starts one. */
  readonly thread: EnvironmentThreadShell | null;
  readonly threadId?: ThreadId;
  readonly messageId?: MessageId;
  readonly text: string;
  readonly title?: string;
}

/** Sending to a project's Work thread: queued behind a running turn, never steering it. */
export function useSendWorkMessage() {
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  return async (message: WorkMessage): Promise<ThreadId | null> => {
    const threadId = message.thread?.id ?? message.threadId ?? ThreadId.make(uuidv4());
    const createdAt = new Date().toISOString();
    const body = {
      messageId: message.messageId ?? MessageId.make(uuidv4()),
      role: "user" as const,
      text: message.text,
      attachments: [],
    };
    let result;
    if (message.thread === null) {
      const config = appAtomRegistry.get(environmentServerConfigsAtom).get(message.environmentId);
      const modelSelection = scheduledTaskDefaultModel(config ?? null, { id: message.projectId });
      const runtimeMode = resolveProjectSettings(
        config?.settings ?? DEFAULT_SERVER_SETTINGS,
        message.projectId,
      ).settings.defaultRuntimeMode;
      if (modelSelection === null) {
        Dialog.alert("No agent is ready", "Sign in to a provider on the host, then try again.");
        return null;
      }
      const title = message.title ?? deriveThreadTitleSeed({ text: message.text, attachments: [] });
      result = await startTurn({
        environmentId: message.environmentId,
        input: {
          threadId,
          creationSource: "mobile",
          message: body,
          modelSelection,
          runtimeMode,
          interactionMode: "default",
          titleSeed: title,
          bootstrap: {
            createThread: {
              projectId: message.projectId,
              title,
              modelSelection,
              runtimeMode,
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              createdAt,
            },
          },
          createdAt,
        },
      });
    } else {
      result = await startTurn({
        environmentId: message.environmentId,
        input: {
          threadId,
          message: body,
          runtimeMode: message.thread.runtimeMode,
          interactionMode: message.thread.interactionMode,
          dispatchMode: "queue",
          createdAt,
        },
      });
    }
    if (result._tag === "Failure") {
      alertFailure("Could not send to the agent", result);
      return null;
    }
    return threadId;
  };
}

/**
 * Sends notes as one message. They are marked sent first, with the message id, so the run the
 * message starts links back to them; a failed send reopens them.
 */
export function useSendNotes() {
  const markSent = useAtomCommand(workEnvironment.markNotesSent, { reportFailure: false });
  const setStatus = useAtomCommand(workEnvironment.setNoteStatus, { reportFailure: false });
  const send = useSendWorkMessage();
  return async (input: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly thread: EnvironmentThreadShell | null;
    readonly deliverable: Deliverable;
    readonly version: DeliverableVersion;
    readonly notes: ReadonlyArray<DeliverableNote>;
  }): Promise<boolean> => {
    if (input.notes.length === 0) return false;
    const threadId = input.thread?.id ?? ThreadId.make(uuidv4());
    const messageId = MessageId.make(uuidv4());
    const noteIds = input.notes.map((note) => note.id);
    const marked = await markSent({
      environmentId: input.environmentId,
      input: { noteIds, threadId, messageId },
    });
    if (marked._tag === "Failure") {
      alertFailure("Could not send the notes", marked);
      return false;
    }
    const sent = await send({
      environmentId: input.environmentId,
      projectId: input.projectId,
      thread: input.thread,
      threadId,
      messageId,
      title: input.deliverable.title,
      text: formatNotesMessage({
        deliverable: input.deliverable,
        versionOrdinal: input.version.ordinal,
        notes: input.notes.map((note) => ({
          id: note.id,
          anchor: note.anchor,
          body: note.body,
          hasSnapshot: note.snapshotUrl !== null,
        })),
      }),
    });
    if (sent === null) {
      await Promise.all(
        noteIds.map((noteId) =>
          setStatus({ environmentId: input.environmentId, input: { noteId, status: "open" } }),
        ),
      );
      return false;
    }
    return true;
  };
}

/** A starter chip: a new Work project and its thread with the starter's prompt. */
export function useStartWorkProject() {
  const createNew = useAtomCommand(projectEnvironment.createNew, { reportFailure: false });
  const send = useSendWorkMessage();
  return async (environmentId: EnvironmentId, starter: WorkStarter): Promise<ProjectId | null> => {
    const created = await createNew({
      environmentId,
      input: { name: starter.projectName, kind: "work" },
    });
    if (created._tag === "Failure") {
      alertFailure("Could not create the project", created);
      return null;
    }
    const { projectId } = created.value;
    const project = await waitForProject(scopeProjectRef(environmentId, projectId));
    if (project === null) return null;
    await send({
      environmentId,
      projectId,
      thread: null,
      text: starter.prompt,
      title: starter.label,
    });
    return projectId;
  };
}
