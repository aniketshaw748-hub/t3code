import {
  Deliverable,
  DeliverableAnchor,
  DeliverableComparison,
  DeliverableId,
  DeliverableRendition,
  DeliverableRestoreResult,
  DeliverableVersion,
  DeliverableVersionGraph,
  DeliverableVersionId,
  OrchestratorMcpClientRequestId,
  OrchestratorMcpFailure,
  ProjectId,
  SpendApprovalEstimate,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as DeliverableService from "../../../deliverables/DeliverableService.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as SpendApprovals from "../../../spend/SpendApprovals.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    DeliverableService.DeliverableService,
  ],
};

const ProjectTarget = Schema.optional(ProjectId).annotate({
  description: "Defaults to the calling thread's project.",
});

const DeliverablesListTool = Tool.make("deliverables_list", {
  ...shared,
  description:
    "List the project's deliverables (decks, videos, images, PDFs) with their current version. Read it before editing one: the user may have undone or restored a version.",
  parameters: Schema.Struct({ projectId: ProjectTarget }),
  success: Schema.Struct({ deliverables: Schema.Array(Deliverable) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true);

const DeliverableVersionsTool = Tool.make("deliverable_versions", {
  ...shared,
  description:
    "A deliverable's versions (V1, V2...) with summaries, render status and self-check, plus the version graph: current version, undo/redo availability and alternates left by forks.",
  parameters: Schema.Struct({ deliverableId: DeliverableId }),
  success: Schema.Struct({
    deliverable: Deliverable,
    versions: Schema.Array(DeliverableVersion),
    graph: DeliverableVersionGraph,
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true);

const DeliverableCompareTool = Tool.make("deliverable_compare", {
  ...shared,
  description:
    "What changed between two versions: each slide or shot marked changed, unchanged, added or removed, with a 0-1 difference and where in the frame it changed. Omit baseVersionId to compare with the version it was made from.",
  parameters: Schema.Struct({
    targetVersionId: DeliverableVersionId,
    baseVersionId: Schema.optional(DeliverableVersionId),
  }),
  success: DeliverableComparison,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true);

const DeliverableRenditionsTool = Tool.make("deliverable_renditions", {
  ...shared,
  description:
    "Rendered views of a version: per-slide or per-shot images and thumbnails, poster, low-res proxy and the original file, as URLs relative to this server (valid for an hour). Status pending/rendering means try again shortly.",
  parameters: Schema.Struct({ versionId: DeliverableVersionId }),
  success: DeliverableRendition,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true);

const DeliverableRegisterVersionTool = Tool.make("deliverable_register_version", {
  ...shared,
  description:
    "Record the file's current state as a new version (V1, V2...). Turns that change a .pptx, video or PDF are recorded automatically; call this for images, for a mid-turn milestone, or to say where the change should land so it is self-checked once rendered.",
  parameters: Schema.Struct({
    path: TrimmedNonEmptyString.annotate({ description: "Inside the project." }),
    projectId: ProjectTarget,
    title: Schema.optional(TrimmedNonEmptyString),
    summary: Schema.optional(
      Schema.String.check(Schema.isMaxLength(2_000)).annotate({
        description: "One line: what changed and why.",
      }),
    ),
    expectedChanges: Schema.optional(
      Schema.Array(DeliverableAnchor).check(Schema.isMaxLength(64)).annotate({
        description:
          "Where the request said to change: {kind:'slide',index} (0-based), {kind:'time',t,tEnd} seconds, optional region {x,y,w,h} 0-1.",
      }),
    ),
  }),
  success: Schema.Struct({
    deliverable: Deliverable,
    version: DeliverableVersion,
    created: Schema.Boolean,
  }),
}).annotate(Tool.Destructive, false);

const DeliverableRestoreTool = Tool.make("deliverable_restore", {
  ...shared,
  description:
    "Undo, redo, or restore a version: rewrites the deliverable's files (and the sources that changed with it) in the workspace. Nothing is deleted; editing after an undo forks a new line. Refused while an agent turn runs in the project, or when files changed since the current version.",
  parameters: Schema.Struct({
    deliverableId: DeliverableId,
    to: Schema.Union([Schema.Literals(["previous", "next"]), DeliverableVersionId]).annotate({
      description: "`previous` (undo), `next` (redo), or a version id.",
    }),
  }),
  success: DeliverableRestoreResult,
}).annotate(Tool.Destructive, true);

const RequestSpendApprovalTool = Tool.make("request_spend_approval", {
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    SpendApprovals.SpendApprovals,
  ],
  description:
    "Before a paid generation step (image, video, voice, render credits), show the user its cost and wait for approve or decline. Spend only on `approved`.",
  parameters: Schema.Struct({
    description: TrimmedNonEmptyString.annotate({
      description: "Plain words: what will be generated.",
    }),
    estimate: SpendApprovalEstimate,
    service: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
    settings: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    clientRequestId: Schema.optional(OrchestratorMcpClientRequestId),
    timeoutMs: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 1_000, maximum: 3_600_000 })),
    ),
  }),
  success: Schema.Struct({
    status: Schema.Literals(["approved", "declined", "cancelled", "timed_out"]),
    note: Schema.optional(Schema.String),
  }),
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

export const DeliverablesToolkit = Toolkit.make(
  DeliverablesListTool,
  DeliverableVersionsTool,
  DeliverableCompareTool,
  DeliverableRenditionsTool,
  DeliverableRegisterVersionTool,
  DeliverableRestoreTool,
  RequestSpendApprovalTool,
);
