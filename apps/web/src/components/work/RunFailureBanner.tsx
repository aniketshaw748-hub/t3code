import { type WorkRunFailure, workRunFailureDetail } from "@t3tools/client-runtime/work/shelf";
import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";

/** The agent's last run ended early: what happened in plain words, and a way to try again. */
export function RunFailureBanner(props: {
  readonly failure: WorkRunFailure;
  readonly canOperate: boolean;
  readonly retrying: boolean;
  /** Null when there is nothing to send again. */
  readonly onRetry: (() => void) | null;
  readonly onShowChat: () => void;
}) {
  return (
    <Alert variant={props.failure.kind === "error" ? "error" : "warning"} className="shrink-0">
      <CircleAlertIcon aria-hidden />
      <AlertTitle>{props.failure.title}</AlertTitle>
      <AlertDescription>{workRunFailureDetail(props.failure)}</AlertDescription>
      <AlertAction>
        <Button size="xs" variant="ghost" onClick={props.onShowChat}>
          Details
        </Button>
        {props.canOperate && props.onRetry !== null ? (
          <Button size="xs" variant="outline" disabled={props.retrying} onClick={props.onRetry}>
            <RotateCcwIcon />
            Retry
          </Button>
        ) : null}
      </AlertAction>
    </Alert>
  );
}
