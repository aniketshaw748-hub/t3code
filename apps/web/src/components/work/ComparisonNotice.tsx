import type { DeliverableComparison } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { CircleAlertIcon, HourglassIcon, RotateCcwIcon } from "lucide-react";

import { InlineButton } from "../ui/button";

/** Why two versions show no comparison: the cause in words, with its own icon. */
export function ComparisonNotice(props: {
  readonly result: AsyncResult.AsyncResult<DeliverableComparison, unknown>;
  readonly onRetry: () => void;
}) {
  const unavailable = AsyncResult.getOrElse(props.result, () => null)?.unavailable ?? null;
  const failed = AsyncResult.isFailure(props.result);
  if (unavailable === null && !failed) return null;
  const waiting = unavailable?.reason === "rendering";
  const Icon = waiting ? HourglassIcon : CircleAlertIcon;
  return (
    <p role="status" className="flex items-start gap-1.5 text-sm text-muted-foreground">
      <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {unavailable?.message ?? "The comparison could not be loaded from the server."}
        {unavailable?.reason === "comparison_failed" || (unavailable === null && failed) ? (
          <>
            {" "}
            <InlineButton onClick={props.onRetry}>
              <RotateCcwIcon aria-hidden className="mr-1 inline size-3" />
              Try again
            </InlineButton>
          </>
        ) : null}
      </span>
    </p>
  );
}
