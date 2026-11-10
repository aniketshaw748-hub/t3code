import type {
  CheckpointId,
  CheckpointScopeId,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";

export interface TurnContext {
  readonly projectId: ProjectId;
  /** Where the turn ran: the project root or the thread's worktree. */
  readonly cwd: string;
  /** The agent's last reply in the run, for the version summary. */
  readonly reply: string | null;
  /** The checkpoint before this one, for listing what the turn changed. */
  readonly parentCheckpointRef: string | null;
}

export type ProjectState =
  | {
      readonly type: "active" | "deleted";
      readonly workspaceRoot: string;
      readonly title: string;
    }
  /** No project with this id was ever recorded here. */
  | { readonly type: "missing" }
  /** The project could not be read just now; nothing may be concluded from that. */
  | { readonly type: "unknown" };

/** What deliverables need from projects and threads, kept narrow so the engine tests alone. */
export class DeliverableContext extends Context.Service<
  DeliverableContext,
  {
    readonly projectRoot: (projectId: ProjectId) => Effect.Effect<string | null>;
    /** Whether a project is still there; a deleted one keeps its folder and the refs in it. */
    readonly projectState: (projectId: ProjectId) => Effect.Effect<ProjectState>;
    readonly turn: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId | null;
      readonly scopeId: CheckpointScopeId;
      readonly parentCheckpointId: CheckpointId | null;
    }) => Effect.Effect<TurnContext | null>;
    /** Whether an agent turn is running in the project's own checkout. */
    readonly projectBusy: (projectId: ProjectId) => Effect.Effect<boolean>;
  }
>()("t3/deliverables/DeliverableContext") {}

const make = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const threads = yield* ThreadManagementService.ThreadManagementService;

  return DeliverableContext.of({
    projectRoot: Effect.fn("DeliverableContext.projectRoot")(function* (projectId) {
      const project = yield* projects.get(projectId).pipe(Effect.orElseSucceed(Option.none));
      return Option.match(project, { onNone: () => null, onSome: (row) => row.workspaceRoot });
    }),
    projectState: Effect.fn("DeliverableContext.projectState")(function* (projectId) {
      return yield* projects.get(projectId, { includeDeleted: true }).pipe(
        Effect.map(
          Option.match({
            onNone: (): ProjectState => ({ type: "missing" }),
            onSome: (row): ProjectState => ({
              type: row.deletedAt === null ? "active" : "deleted",
              workspaceRoot: row.workspaceRoot,
              title: row.title,
            }),
          }),
        ),
        Effect.orElseSucceed((): ProjectState => ({ type: "unknown" })),
      );
    }),
    turn: Effect.fn("DeliverableContext.turn")(function* (input) {
      const records = yield* threads
        .getThreadRecords(input.threadId, ["checkpointScopes", "checkpoints", "messages"], {
          messageRoles: ["assistant"],
        })
        .pipe(Effect.orElseSucceed(() => null));
      if (records === null) return null;
      const scope = records.checkpointScopes.find((candidate) => candidate.id === input.scopeId);
      if (scope === undefined) return null;
      const reply = records.messages.findLast(
        (message) =>
          message.role === "assistant" && message.runId === input.runId && !message.streaming,
      );
      const parent = records.checkpoints.find(
        (candidate) => candidate.id === input.parentCheckpointId,
      );
      return {
        projectId: records.thread.projectId,
        cwd: scope.cwd,
        reply: reply?.text ?? null,
        parentCheckpointRef: parent?.ref ?? null,
      };
    }),
    projectBusy: Effect.fn("DeliverableContext.projectBusy")(function* (projectId) {
      const shells = yield* threads
        .listProjectThreads({ projectId, includeSubagents: true })
        .pipe(Effect.orElseSucceed(() => []));
      return shells.some((shell) => shell.activeRunId !== null && shell.worktreePath === null);
    }),
  });
});

export const layer = Layer.effect(DeliverableContext, make);
