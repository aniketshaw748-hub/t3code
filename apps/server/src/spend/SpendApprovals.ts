// Approve-before-spend: an agent about to run a paid generation step raises a card in its
// thread and waits while the user approves or declines. Built on the same turn-item card and
// internal record command as secret requests, so it shows, recovers and closes the same way.
import {
  CommandId,
  type ProviderInstanceId,
  type SpendApprovalAnswerInput,
  type SpendApprovalEstimate,
  SpendApprovalError,
  type ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";

const POLL_INTERVAL_MS = 500;
const SPEND_APPROVAL_DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_TIMEOUT_MS = 60 * 60 * 1_000;

export type SpendApprovalOutcome = "approved" | "declined" | "cancelled" | "timed_out";

export interface SpendApprovalRequest {
  readonly threadId: ThreadId;
  /** The asking provider session's instance; only its own active run may ask. */
  readonly providerInstanceId: ProviderInstanceId;
  /** Retries with the same key reuse the card instead of asking twice. */
  readonly requestKey: string;
  readonly description: string;
  readonly estimate: SpendApprovalEstimate;
  readonly service?: string | undefined;
  readonly model?: string | undefined;
  readonly settings?: Readonly<Record<string, string>> | undefined;
  readonly timeoutMs?: number | undefined;
}

export class SpendApprovals extends Context.Service<
  SpendApprovals,
  {
    /** Shows the card and waits for the user's answer, the run's end, or the timeout. */
    readonly request: (
      input: SpendApprovalRequest,
    ) => Effect.Effect<SpendApprovalOutcome, SpendApprovalError>;
    readonly answer: (input: SpendApprovalAnswerInput) => Effect.Effect<void, SpendApprovalError>;
  }
>()("t3/spend/SpendApprovals") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;

  const loadCards = (threadId: ThreadId) =>
    threads
      .getThreadRecords(threadId, ["runs", "turnItems"], {
        turnItemTypes: ["spend_approval"],
        messageRoles: [],
      })
      .pipe(Effect.mapError((cause) => new SpendApprovalError({ reason: "load_failed", cause })));

  const request: SpendApprovals["Service"]["request"] = Effect.fn("SpendApprovals.request")(
    function* (input) {
      const records = yield* loadCards(input.threadId);
      const run = ThreadManagementService.latestActiveRun(records);
      if (
        run === undefined ||
        run.rootNodeId === null ||
        run.providerInstanceId !== input.providerInstanceId
      ) {
        return yield* new SpendApprovalError({ reason: "agent_stopped" });
      }
      const nodeId = run.rootNodeId;
      const key = encodeURIComponent(input.requestKey);
      const turnItemId = TurnItemId.make(
        `turn-item:spend-approval:${encodeURIComponent(input.threadId)}:${key}`,
      );
      const record = (approvalStatus: "pending" | "cancelled") =>
        threads
          .dispatch({
            type: "spend_approval.record",
            commandId: CommandId.make(`spend-approval:${turnItemId}:${approvalStatus}`),
            threadId: input.threadId,
            runId: run.id,
            nodeId,
            turnItemId,
            description: input.description,
            estimate: input.estimate,
            ...(input.service === undefined ? {} : { service: input.service }),
            ...(input.model === undefined ? {} : { model: input.model }),
            ...(input.settings === undefined ? {} : { settings: input.settings }),
            approvalStatus,
          })
          .pipe(
            Effect.mapError((cause) => new SpendApprovalError({ reason: "record_failed", cause })),
          );
      yield* record("pending");
      // Only this call can tell the agent the answer, so the card closes with it.
      const closeCard = record("cancelled").pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not close a spend approval card", { reason: error.reason }),
        ),
      );
      const answered = yield* Effect.gen(function* () {
        while (true) {
          const current = yield* loadCards(input.threadId);
          const card = current.turnItems.find((item) => item.id === turnItemId);
          if (card?.type === "spend_approval" && card.approvalStatus !== "pending") {
            return card.approvalStatus;
          }
          const live = current.runs.find((candidate) => candidate.id === run.id);
          if (live === undefined || ThreadManagementService.isTerminalRunStatus(live.status)) {
            yield* closeCard;
            return "cancelled" as const;
          }
          yield* Effect.sleep(Duration.millis(POLL_INTERVAL_MS));
        }
      }).pipe(
        Effect.timeoutOption(
          Duration.millis(
            Math.min(input.timeoutMs ?? SPEND_APPROVAL_DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
          ),
        ),
        Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : closeCard)),
      );
      if (Option.isSome(answered)) return answered.value;
      yield* closeCard;
      // An answer can land between the last read and the close; the record keeps it.
      const settled = yield* loadCards(input.threadId).pipe(Effect.option);
      const card = Option.getOrUndefined(settled)?.turnItems.find((item) => item.id === turnItemId);
      return card?.type === "spend_approval" &&
        (card.approvalStatus === "approved" || card.approvalStatus === "declined")
        ? card.approvalStatus
        : "timed_out";
    },
  );

  const answer: SpendApprovals["Service"]["answer"] = Effect.fn("SpendApprovals.answer")(
    function* (input) {
      yield* Effect.annotateCurrentSpan({
        "orchestration_v2.thread_id": input.threadId,
        "spend_approval.decision": input.decision,
      });
      const records = yield* loadCards(input.threadId);
      const card = records.turnItems.find((item) => item.id === input.turnItemId);
      if (card?.type !== "spend_approval" || card.runId === null || card.nodeId === null) {
        return yield* new SpendApprovalError({ reason: "not_found" });
      }
      if (card.approvalStatus !== "pending") {
        return yield* new SpendApprovalError({ reason: "already_answered" });
      }
      const run = records.runs.find((candidate) => candidate.id === card.runId);
      if (run === undefined || ThreadManagementService.isTerminalRunStatus(run.status)) {
        return yield* new SpendApprovalError({ reason: "agent_stopped" });
      }
      const approvalStatus = input.decision === "approve" ? "approved" : "declined";
      yield* threads
        .dispatch({
          type: "spend_approval.record",
          commandId: CommandId.make(`spend-approval:${card.id}:${approvalStatus}`),
          threadId: input.threadId,
          runId: card.runId,
          nodeId: card.nodeId,
          turnItemId: card.id,
          description: card.description,
          estimate: card.estimate,
          ...(card.service === undefined ? {} : { service: card.service }),
          ...(card.model === undefined ? {} : { model: card.model }),
          ...(card.settings === undefined ? {} : { settings: card.settings }),
          approvalStatus,
        })
        .pipe(
          Effect.mapError((cause) => new SpendApprovalError({ reason: "record_failed", cause })),
        );
    },
  );

  return SpendApprovals.of({ request, answer });
});

export const layer = Layer.effect(SpendApprovals, make);
