import type { DeliverableSelfCheckResult } from "@t3tools/contracts";
import { CheckIcon, CircleAlertIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** The self-check a version got after rendering, kept to a quiet line in the header. */
export function SelfCheckBadge({ result }: { readonly result: DeliverableSelfCheckResult }) {
  if (result.status === "skipped") return null;
  const passed = result.status === "passed";
  const label = passed
    ? "Checked: change landed where you asked"
    : `Check: ${result.findings[0] ?? "the change is not where you asked"}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="hidden min-w-0 items-center gap-1 truncate rounded-md text-xs text-work-muted outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-work-highlight md:inline-flex"
          >
            {passed ? (
              <CheckIcon className="size-3.5 shrink-0 text-work-status-resolved" aria-hidden />
            ) : (
              <CircleAlertIcon className="size-3.5 shrink-0 text-work-status-open" aria-hidden />
            )}
            <span className="truncate">{label}</span>
          </span>
        }
      />
      <TooltipPopup side="bottom">
        {result.findings.length === 0 ? label : result.findings.join(" ")}
      </TooltipPopup>
    </Tooltip>
  );
}
