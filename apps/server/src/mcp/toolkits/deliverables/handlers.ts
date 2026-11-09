import {
  type DeliverableError,
  DeliverableVersionId,
  OrchestratorMcpFailure,
  SPEND_APPROVAL_UNAPPROVED_NOTE,
  type SpendApprovalError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as DeliverableService from "../../../deliverables/DeliverableService.ts";
import * as SpendApprovals from "../../../spend/SpendApprovals.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { loadCaller, resolveProjectId } from "../../threadAccess.ts";
import { DeliverablesToolkit } from "./tools.ts";

const SERVER_SIDE: ReadonlySet<DeliverableError["reason"]> = new Set([
  "storage_failed",
  "git_failed",
  "persistence_failed",
]);

const toFailure = (error: DeliverableError) =>
  new OrchestratorMcpFailure({
    code: SERVER_SIDE.has(error.reason) ? "orchestration_error" : "invalid_request",
    message: error.message,
  });

const spendFailure = (error: SpendApprovalError) =>
  new OrchestratorMcpFailure({
    code: error.reason === "agent_stopped" ? "parent_not_active" : "orchestration_error",
    message: error.message,
  });

const callerProject = (projectId: Parameters<typeof resolveProjectId>[1]) =>
  loadCaller().pipe(Effect.flatMap((caller) => resolveProjectId(caller, projectId)));

export const layer = McpToolAccess.toLayer(
  DeliverablesToolkit,
  Effect.gen(function* () {
    const deliverables = yield* DeliverableService.DeliverableService;
    const spendApprovals = yield* SpendApprovals.SpendApprovals;
    const random = yield* SecureRandom.SecureRandom;
    return {
      deliverables_list: McpToolAccess.reads((input) =>
        Effect.gen(function* () {
          const projectId = yield* callerProject(input.projectId);
          const list = yield* deliverables.list(projectId).pipe(Effect.mapError(toFailure));
          return { deliverables: list };
        }),
      ),
      deliverable_versions: McpToolAccess.reads((input) =>
        Effect.gen(function* () {
          const { deliverable, versions } = yield* deliverables.versions(input.deliverableId);
          const graph = yield* deliverables.versionGraph(input.deliverableId);
          return { deliverable, versions, graph };
        }).pipe(Effect.mapError(toFailure)),
      ),
      deliverable_compare: McpToolAccess.reads((input) =>
        deliverables.compare(input).pipe(Effect.mapError(toFailure)),
      ),
      deliverable_renditions: McpToolAccess.reads((input) =>
        deliverables.rendition(input.versionId).pipe(Effect.mapError(toFailure)),
      ),
      deliverable_register_version: McpToolAccess.writesWithCapability((input) =>
        Effect.gen(function* () {
          const scope = yield* McpInvocationContext.McpInvocationContext;
          const projectId = yield* callerProject(input.projectId);
          return yield* deliverables
            .registerVersion({
              projectId,
              path: input.path,
              ...(input.title === undefined ? {} : { title: input.title }),
              ...(input.summary === undefined ? {} : { summary: input.summary }),
              ...(input.expectedChanges === undefined
                ? {}
                : { expectedChanges: input.expectedChanges }),
              ...(scope.thread === undefined ? {} : { threadId: scope.thread.threadId }),
            })
            .pipe(Effect.mapError(toFailure));
        }),
      ),
      deliverable_restore: McpToolAccess.writesWithCapability((input) =>
        (input.to === "previous"
          ? deliverables.undo(input.deliverableId)
          : input.to === "next"
            ? deliverables.redo(input.deliverableId)
            : deliverables.restore({
                deliverableId: input.deliverableId,
                versionId: DeliverableVersionId.make(input.to),
              })
        ).pipe(Effect.mapError(toFailure)),
      ),
      request_spend_approval: McpToolAccess.actsAsCaller((input) =>
        Effect.gen(function* () {
          const scope = yield* McpInvocationContext.McpInvocationContext;
          const { thread } = yield* McpInvocationContext.requireThreadScope(
            scope,
            "request_spend_approval",
          );
          const status = yield* spendApprovals
            .request({
              threadId: thread.threadId,
              providerInstanceId: thread.providerInstanceId,
              requestKey: `${scope.requestNamespace}:${input.clientRequestId ?? (yield* random.uuidV4())}`,
              description: input.description,
              estimate: input.estimate,
              service: input.service,
              model: input.model,
              settings: input.settings,
              timeoutMs: input.timeoutMs,
            })
            .pipe(Effect.mapError(spendFailure));
          return status === "approved"
            ? { status }
            : { status, note: SPEND_APPROVAL_UNAPPROVED_NOTE[status] };
        }),
      ),
    } satisfies McpToolAccess.Handlers<typeof DeliverablesToolkit.tools>;
  }),
);
