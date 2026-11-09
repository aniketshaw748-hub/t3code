import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ShieldIcon } from "lucide-react";
import { useState } from "react";

import { environmentThreadDetails, threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { ComposerRequestCard } from "./ComposerRequestCard";
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
        <div key={approval.requestId} className="overflow-hidden rounded-card surface-panel">
          <ComposerRequestCard.Root role="region" aria-label="Approval needed">
            <ComposerRequestCard.Header
              icon={<ShieldIcon className="text-warning-foreground" />}
              title="Approval needed"
            />
            {approval.detail ? (
              <ComposerRequestCard.Well>
                <pre className="max-h-24 overflow-auto whitespace-pre-wrap p-2 font-mono text-meta text-foreground wrap-anywhere">
                  {approval.detail}
                </pre>
              </ComposerRequestCard.Well>
            ) : null}
            <ComposerRequestCard.Footer>
              <ComposerPendingApprovalActions
                designLabels
                showShortcutHints={false}
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
            </ComposerRequestCard.Footer>
            {error ? (
              <p role="alert" className="px-2.5 text-meta text-error-foreground">
                {error}
              </p>
            ) : null}
          </ComposerRequestCard.Root>
        </div>
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
