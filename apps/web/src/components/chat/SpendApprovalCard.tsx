import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { formatSpendAmount, spendApprovalDetails } from "@t3tools/client-runtime/work/anchors";
import type { EnvironmentId, OrchestrationV2TurnItem } from "@t3tools/contracts";
import { CheckIcon, CoinsIcon, MinusIcon } from "lucide-react";
import { useRef, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { ComposerRequestCard } from "./ComposerRequestCard";
import { WorkLogRow } from "./WorkLog";

export type SpendApprovalItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "spend_approval" }
>;

const ANSWERED_LABEL: Record<Exclude<SpendApprovalItem["approvalStatus"], "pending">, string> = {
  approved: "Approved",
  declined: "Declined",
  cancelled: "Closed with the run",
};

/**
 * The agent's ask before a paid generation step: what it will make, with which model and
 * settings, and what it costs. Answered cards shrink to one line.
 */
export function SpendApprovalCard(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SpendApprovalItem;
  /** An approval inherited from another thread (a fork) can only be answered where it was asked. */
  readonly visibility: "local" | "inherited" | "synthetic";
}) {
  const { item } = props;
  if (item.approvalStatus !== "pending" || props.visibility !== "local") {
    const Icon = item.approvalStatus === "approved" ? CheckIcon : MinusIcon;
    return (
      <WorkLogRow
        data-v2-item-type={item.type}
        icon={<Icon className="size-3.5 text-icon-muted" aria-hidden />}
        label={item.description}
        trailing={
          <span className="flex shrink-0 items-center gap-2 text-dim-foreground">
            <span className="tabular-nums">{formatSpendAmount(item.estimate)}</span>
            <span>
              {item.approvalStatus === "pending"
                ? "Waiting for an answer in the original thread"
                : ANSWERED_LABEL[item.approvalStatus]}
            </span>
          </span>
        }
      />
    );
  }
  return <PendingSpendApproval environmentId={props.environmentId} item={item} />;
}

function PendingSpendApproval(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SpendApprovalItem;
}) {
  const { item } = props;
  const answer = useAtomCommand(serverEnvironment.answerSpendApproval, {
    label: "answer spend approval",
    reportFailure: false,
  });
  const canAnswer = useAtomValue(
    serverEnvironment.answerSpendApproval.permissionAtom(props.environmentId),
  );
  const [pending, setPending] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Two clicks can land before a render.
  const inFlight = useRef(false);
  const send = async (decision: "approve" | "decline") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(decision);
    setError(null);
    const result = await answer({
      environmentId: props.environmentId,
      input: { threadId: item.threadId, turnItemId: item.id, decision },
    });
    inFlight.current = false;
    setPending(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "Could not record the answer.");
    }
  };
  const details = spendApprovalDetails(item);
  return (
    <div data-v2-item-type={item.type} className="overflow-hidden rounded-card surface-panel">
      <ComposerRequestCard.Root role="region" aria-label="Approve before spending">
        <ComposerRequestCard.Header
          icon={<CoinsIcon className="text-warning-foreground" />}
          title="Approve before spending"
          sub={`About ${formatSpendAmount(item.estimate)}`}
        />
        <ComposerRequestCard.Body>
          <p className="wrap-anywhere">{item.description}</p>
        </ComposerRequestCard.Body>
        {details.length > 0 ? (
          <ComposerRequestCard.Well>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-2 text-meta">
              {details.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{key}</dt>
                  <dd className="min-w-0 wrap-anywhere text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          </ComposerRequestCard.Well>
        ) : null}
        {error === null ? null : (
          <p role="alert" className="px-2.5 text-meta text-error-foreground">
            {error}
          </p>
        )}
        <ComposerRequestCard.Footer>
          {canAnswer ? null : (
            <p className="me-auto text-meta text-muted-foreground">
              This connection can't approve spending.
            </p>
          )}
          <Button
            size="sm"
            variant="ghost-muted"
            disabled={!canAnswer || pending !== null}
            onClick={() => void send("decline")}
          >
            Decline
          </Button>
          <Button
            size="sm"
            variant="default"
            disabled={!canAnswer || pending !== null}
            onClick={() => void send("approve")}
          >
            {pending === "approve" ? "Approving…" : "Approve"}
          </Button>
        </ComposerRequestCard.Footer>
      </ComposerRequestCard.Root>
    </div>
  );
}
