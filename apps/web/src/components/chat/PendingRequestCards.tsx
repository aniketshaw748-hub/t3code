import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ShieldAlertIcon } from "lucide-react";
import { useState } from "react";

import { environmentThreadDetails, threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { PendingQuestionCard } from "./PendingQuestionCard";

/** A thread's pending approvals and questions, for surfaces that have no chat composer. */
export function PendingRequestCards(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly onOpenFull?: () => void;
}) {
  const ref = scopeThreadRef(props.environmentId, props.threadId);
  const requests = useAtomValue(environmentThreadDetails.pendingRequestsAtom(ref));
  const respond = useAtomCommand(threadEnvironment.respondToApproval, { reportFailure: false });
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (requests === null) return null;
  return (
    <>
      {requests.approvals.map((approval) => (
        <section
          key={approval.requestId}
          aria-label="Approval needed"
          className="flex min-w-0 shrink-0 flex-col gap-3 rounded-xl border border-border/60 bg-card p-3"
        >
          <p className="flex items-center gap-2 text-xs font-medium text-foreground">
            <ShieldAlertIcon className="size-3.5 shrink-0 text-warning" aria-hidden />
            Approval needed
          </p>
          {approval.detail ? (
            <pre className="max-h-24 overflow-auto rounded-md bg-muted p-2 font-mono text-2xs wrap-anywhere whitespace-pre-wrap text-foreground">
              {approval.detail}
            </pre>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ComposerPendingApprovalActions
              requestId={approval.requestId}
              isResponding={responding}
              canRespond={approval.responseCapability === "live"}
              {...(approval.options === undefined ? {} : { options: approval.options })}
              onRespondToApproval={async (requestId, decision) => {
                setResponding(true);
                setError(null);
                const result = await respond({
                  environmentId: props.environmentId,
                  input: { threadId: props.threadId, requestId, decision },
                });
                if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                  const failure = squashAtomCommandFailure(result);
                  setError(failure instanceof Error ? failure.message : "Could not send that.");
                }
                setResponding(false);
                return result;
              }}
            />
          </div>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </section>
      ))}
      {requests.userInputs.map((request) => (
        <PendingQuestionCard
          key={request.requestId}
          environmentId={props.environmentId}
          threadId={props.threadId}
          request={request}
          {...(props.onOpenFull === undefined ? {} : { onOpenFull: props.onOpenFull })}
        />
      ))}
    </>
  );
}
