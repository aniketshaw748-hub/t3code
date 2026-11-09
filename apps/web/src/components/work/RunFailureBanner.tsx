import { type WorkRunFailure, workRunFailureDetail } from "@t3tools/client-runtime/work/shelf";
import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";

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
    <div
      role="alert"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-work-status-open/10 px-3 py-2 ring-1 ring-work-status-open/30"
    >
      <CircleAlertIcon className="size-4 shrink-0 text-work-status-open" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-work-ink">
        <span className="font-medium">{props.failure.title}.</span>{" "}
        {workRunFailureDetail(props.failure)}
      </p>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="xs" variant="ghost" onClick={props.onShowChat}>
          Details
        </Button>
        {props.canOperate && props.onRetry !== null ? (
          <Button size="xs" variant="contrast" disabled={props.retrying} onClick={props.onRetry}>
            <RotateCcwIcon />
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
