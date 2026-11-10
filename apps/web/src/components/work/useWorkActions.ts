import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { WorkStarter } from "@t3tools/client-runtime/work/starters";
import {
  DEFAULT_SERVER_SETTINGS,
  type Deliverable,
  type DeliverableNote,
  type DeliverableVersion,
  type EnvironmentId,
  type MessageId,
  type ProjectId,
  type ThreadId,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import { formatNotesMessage } from "@t3tools/shared/deliverableNotes";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";

import { newMessageId, newThreadId } from "../../lib/utils";
import { resolveProjectDefaultProviderModelSelection } from "../../providerInstances";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { waitForProject } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { environmentServerConfigsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { workEnvironment } from "../../state/work";
import { toastManager } from "../ui/toast";

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : "Something failed.";

/** The model and mode a new Work thread starts with: the project's defaults on its server. */
function workThreadDefaults(environmentId: EnvironmentId, projectId: ProjectId) {
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
  const settings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
  const resolved = resolveProjectSettings(settings, projectId).settings;
  const modelSelection =
    resolved.defaultModelSelection ??
    resolveProjectDefaultProviderModelSelection(config?.providers ?? [], settings, projectId);
  return modelSelection === null
    ? null
    : { modelSelection, runtimeMode: resolved.defaultRuntimeMode };
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
  readonly attachments?: ReadonlyArray<UploadChatAttachment>;
}

/** Sending to a project's Work thread: queued behind a running turn, never steering it. */
export function useSendWorkMessage() {
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  return async (message: WorkMessage): Promise<ThreadId | null> => {
    const threadId = message.thread?.id ?? message.threadId ?? newThreadId();
    const messageId = message.messageId ?? newMessageId();
    const createdAt = new Date().toISOString();
    const body = {
      messageId,
      role: "user" as const,
      text: message.text,
      attachments: message.attachments ?? [],
    };
    let result;
    if (message.thread === null) {
      const defaults = workThreadDefaults(message.environmentId, message.projectId);
      if (defaults === null) {
        toastManager.add({
          type: "error",
          title: "No agent is ready",
          description: "Sign in to a provider in Settings, then try again.",
        });
        return null;
      }
      result = await startTurn({
        environmentId: message.environmentId,
        input: {
          threadId,
          message: body,
          modelSelection: defaults.modelSelection,
          runtimeMode: defaults.runtimeMode,
          interactionMode: "default",
          titleSeed: message.title ?? message.text.slice(0, 80),
          bootstrap: {
            createThread: {
              projectId: message.projectId,
              title: message.title ?? "Work",
              modelSelection: defaults.modelSelection,
              runtimeMode: defaults.runtimeMode,
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
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add({
          type: "error",
          title: "Could not send to the agent",
          description: errorMessage(squashAtomCommandFailure(result)),
        });
      }
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
    const threadId = input.thread?.id ?? newThreadId();
    const messageId = newMessageId();
    const noteIds = input.notes.map((note) => note.id);
    const marked = await markSent({
      environmentId: input.environmentId,
      input: { noteIds, threadId, messageId },
    });
    if (marked._tag === "Failure") {
      if (!isAtomCommandInterrupted(marked)) {
        toastManager.add({
          type: "error",
          title: "Could not send the notes",
          description: errorMessage(squashAtomCommandFailure(marked)),
        });
      }
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

/** A starter chip: a new Work project, its thread with the starter's prompt, then its screen. */
export function useStartWorkProject() {
  const createNew = useAtomCommand(projectEnvironment.createNew, { reportFailure: false });
  const send = useSendWorkMessage();
  const navigate = useNavigate();
  return async (environmentId: EnvironmentId, starter: WorkStarter): Promise<boolean> => {
    const created = await createNew({
      environmentId,
      input: { name: starter.projectName, kind: "work" },
    });
    if (created._tag === "Failure") {
      if (!isAtomCommandInterrupted(created)) {
        toastManager.add({
          type: "error",
          title: "Could not create the project",
          description: errorMessage(squashAtomCommandFailure(created)),
        });
      }
      return false;
    }
    const { projectId } = created.value;
    const project = await waitForProject(scopeProjectRef(environmentId, projectId)).catch(
      () => null,
    );
    if (project === null) return false;
    await send({
      environmentId,
      projectId,
      thread: null,
      text: starter.prompt,
      title: starter.label,
    });
    await navigate({
      to: "/work/$environmentId/$projectId",
      params: { environmentId, projectId },
    });
    return true;
  };
}
