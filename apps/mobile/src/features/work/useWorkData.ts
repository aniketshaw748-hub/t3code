import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import {
  threadRuntimeIsActive,
  type EnvironmentThread,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentThreadStructure } from "@t3tools/client-runtime/state/models";
import { agentProgress, type AgentProgress } from "@t3tools/client-runtime/work/notes";
import type { SpendApprovalTurnItem } from "@t3tools/client-runtime/work/anchors";
import {
  isListedThreadLineage,
  type DeliverableRendition,
  type DeliverableRenditionStatus,
  type DeliverableVersionId,
  type EnvironmentId,
  type ProjectId,
  type ScopedThreadRef,
  type WorkProjectSnapshot,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect } from "react";

import { useProjects, useThreadShells } from "../../state/entities";
import { usePreparedConnection } from "../../state/session";
import { environmentThreadDetails } from "../../state/threads";
import { workEnvironment } from "../../state/work";

/** Work projects across connected environments, newest first, archived ones left out. */
export function useWorkProjects() {
  return useProjects()
    .filter((project) => project.kind === "work" && !project.archivedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The live snapshot of one Work project, or null until the first one arrives. */
export function useWorkProjectSnapshot(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): WorkProjectSnapshot | null {
  return useAtomValue(
    workEnvironment.projectSnapshot({ environmentId, input: { projectId } }),
    (result) => AsyncResult.getOrElse(result, () => null),
  );
}

/** The project's listed threads, most recently updated first; the first is the Work thread. */
export function useWorkThreads(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ReadonlyArray<EnvironmentThreadShell> {
  return useThreadShells()
    .filter(
      (shell) =>
        shell.environmentId === environmentId &&
        shell.projectId === projectId &&
        shell.archivedAt === null &&
        shell.deletedAt === null &&
        isListedThreadLineage(shell.lineage),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function isThreadBusy(shell: EnvironmentThreadShell | null | undefined): boolean {
  return shell !== null && shell !== undefined && threadRuntimeIsActive(shell.runtime);
}

/** Resolves the server-relative, signed URLs renditions and notes carry against the host. */
export function useWorkAssetUrl(environmentId: EnvironmentId) {
  const connection = usePreparedConnection(environmentId);
  const httpBaseUrl = connection._tag === "Some" ? connection.value.httpBaseUrl : null;
  return (url: string | null | undefined): string | null =>
    url === null || url === undefined || httpBaseUrl === null
      ? null
      : resolveAssetUrl(httpBaseUrl, url);
}

const NO_RENDITION_ATOM = Atom.make(AsyncResult.initial<DeliverableRendition, never>(false));

/** A version's rendition, refetched when the snapshot says its render status moved. */
export function useRendition(
  environmentId: EnvironmentId,
  versionId: DeliverableVersionId | null,
  renditionStatus: DeliverableRenditionStatus | null,
): DeliverableRendition | null {
  const atom =
    versionId === null
      ? NO_RENDITION_ATOM
      : workEnvironment.rendition({ environmentId, input: { versionId } });
  const rendition = useAtomValue(atom, (result) => AsyncResult.getOrElse(result, () => null));
  const refresh = useAtomRefresh(atom);
  const stale =
    rendition !== null && renditionStatus !== null && rendition.status !== renditionStatus;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refetches the server rendition once the live snapshot reports a newer render status
  useEffect(() => {
    if (stale) refresh();
  }, [stale, refresh]);
  return rendition;
}

const NO_THREAD_ATOM = Atom.make<EnvironmentThread | null>(null);
const NO_STRUCTURE_ATOM = Atom.make<EnvironmentThreadStructure | null>(null);
const NO_REQUESTS_ATOM = Atom.make<PendingThreadRequests | null>(null);

const latestAgentText = (thread: EnvironmentThread | null): string | null =>
  thread?.projection.messages.findLast((message) => message.role === "assistant")?.text ?? null;

/** The agent's latest message, streaming included; the selector skips unrelated updates. */
export function useLatestAgentText(threadRef: ScopedThreadRef | null): string | null {
  return useAtomValue(
    threadRef === null ? NO_THREAD_ATOM : environmentThreadDetails.threadAtom(threadRef),
    latestAgentText,
  );
}

const NO_MESSAGES: EnvironmentThread["projection"]["messages"] = [];

/** The thread's messages; the selector re-renders readers only when the message list changes. */
export function useThreadMessages(
  threadRef: ScopedThreadRef | null,
): EnvironmentThread["projection"]["messages"] {
  return useAtomValue(
    threadRef === null ? NO_THREAD_ATOM : environmentThreadDetails.threadAtom(threadRef),
    (thread) => thread?.projection.messages ?? NO_MESSAGES,
  );
}

/** What the running agent says it is on, read so readers re-render only when that changes. */
export function useAgentProgress(threadRef: ScopedThreadRef | null): AgentProgress {
  const key = useAtomValue(
    threadRef === null ? NO_THREAD_ATOM : environmentThreadDetails.threadAtom(threadRef),
    (thread) => {
      const progress = agentProgress(latestAgentText(thread));
      return `${progress.step ?? ""}|${progress.renderPercent ?? ""}`;
    },
  );
  const [step, percent] = key.split("|");
  return {
    step: step === undefined || step === "" ? null : step,
    renderPercent: percent === undefined || percent === "" ? null : Number(percent),
  };
}

/** Spend approvals the Work thread is waiting on, from its quiet structure. */
export function usePendingSpendApprovals(
  threadRef: ScopedThreadRef | null,
): ReadonlyArray<SpendApprovalTurnItem> {
  const structure = useAtomValue(
    threadRef === null ? NO_STRUCTURE_ATOM : environmentThreadDetails.quietThreadAtom(threadRef),
  );
  return (
    structure?.projection.turnItems.flatMap((item) =>
      item.type === "spend_approval" && item.approvalStatus === "pending" ? [item] : [],
    ) ?? []
  );
}

/** Tool approvals and questions the Work thread's agent is waiting on. */
export function useWorkPendingRequests(
  threadRef: ScopedThreadRef | null,
): PendingThreadRequests | null {
  return useAtomValue(
    threadRef === null ? NO_REQUESTS_ATOM : environmentThreadDetails.pendingRequestsAtom(threadRef),
  );
}
