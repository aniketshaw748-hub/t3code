import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString, TurnItemId } from "./baseSchemas.ts";

export const SpendApprovalEstimate = Schema.Struct({
  amount: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  /** `USD`, `credits`, or the provider's own unit. */
  unit: TrimmedNonEmptyString,
});
export type SpendApprovalEstimate = typeof SpendApprovalEstimate.Type;

export const SpendApprovalAnswerInput = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
  decision: Schema.Literals(["approve", "decline"]),
});
export type SpendApprovalAnswerInput = typeof SpendApprovalAnswerInput.Type;

/** What the agent reads when its card ends without an approval. */
export const SPEND_APPROVAL_UNAPPROVED_NOTE = {
  declined:
    "The user declined this spend. Do not run it or a cheaper variant without asking again; say what is blocked.",
  cancelled: "The card closed with the run. Ask again only if the spend is still needed.",
  timed_out: "No answer in time. Do not spend; ask again later if it is still needed.",
} as const;

const SPEND_APPROVAL_FAILURE_MESSAGES = {
  load_failed: "Could not load the spend approval request.",
  not_found: "This spend approval request no longer exists.",
  already_answered: "This spend approval request was already answered.",
  agent_stopped: "The agent that asked has stopped, so there is nothing to approve.",
  record_failed: "Could not record the answer.",
} as const;

export const SpendApprovalFailureReason = Schema.Literals(
  Object.keys(SPEND_APPROVAL_FAILURE_MESSAGES) as Array<
    keyof typeof SPEND_APPROVAL_FAILURE_MESSAGES
  >,
);
export type SpendApprovalFailureReason = typeof SpendApprovalFailureReason.Type;

export class SpendApprovalError extends Schema.TaggedError<SpendApprovalError>()(
  "SpendApprovalError",
  {
    reason: SpendApprovalFailureReason,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return SPEND_APPROVAL_FAILURE_MESSAGES[this.reason];
  }
}
