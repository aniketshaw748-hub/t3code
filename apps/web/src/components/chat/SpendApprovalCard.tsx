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
        label={
          <>
            {item.description} · {formatSpendAmount(item.estimate)} ·{" "}
            {item.approvalStatus === "pending"
              ? "Waiting for an answer in the original thread"
              : ANSWERED_LABEL[item.approvalStatus]}
          </>
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
    <section
      data-v2-item-type={item.type}
      aria-label="Approve before spending"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-card p-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <CoinsIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-medium wrap-anywhere text-foreground">{item.description}</p>
          <p className="text-sm text-muted-foreground">
            Costs about{" "}
            <span className="font-medium text-foreground">{formatSpendAmount(item.estimate)}</span>
          </p>
        </div>
      </div>
      {details.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          {details.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="min-w-0 wrap-anywhere text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
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
          variant="contrast"
          disabled={!canAnswer || pending !== null}
          onClick={() => void send("approve")}
        >
          {pending === "approve" ? "Approving…" : "Approve"}
        </Button>
      </div>
      {canAnswer ? null : (
        <p className="text-xs text-muted-foreground">This connection can't approve spending.</p>
      )}
    </section>
  );
}
