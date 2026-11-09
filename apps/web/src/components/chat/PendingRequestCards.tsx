import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
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
          className="flex flex-col gap-1.5 rounded-lg border border-warning/40 bg-warning/8 p-2 text-xs"
        >
          <p className="font-medium text-warning">Approval needed</p>
          {approval.detail ? (
            <pre className="max-h-24 overflow-auto font-mono text-2xs whitespace-pre-wrap break-words">
              {approval.detail}
            </pre>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            <ComposerPendingApprovalActions
              presentation="inline"
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
          {error ? <p className="text-destructive">{error}</p> : null}
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
