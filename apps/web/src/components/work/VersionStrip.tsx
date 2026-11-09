import type { HistoryAvailability, VersionStripItem } from "@t3tools/client-runtime/work/versions";
import type { DeliverableVersionId } from "@t3tools/contracts";
import { GitBranchIcon, Redo2Icon, SplitIcon, Undo2Icon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Button, ContentButton } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * V1..Vn with one-line summaries, undo and redo along the current line, the branches an undo
 * left behind, and the switch into compare mode.
 */
export function VersionStrip(props: {
  readonly items: ReadonlyArray<VersionStripItem>;
  readonly history: HistoryAvailability;
  readonly viewedVersionId: DeliverableVersionId | null;
  /** In compare mode, the two picked versions. */
  readonly compared: ReadonlySet<DeliverableVersionId> | null;
  readonly onView: (versionId: DeliverableVersionId) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onToggleCompare: () => void;
}) {
  const comparing = props.compared !== null;
  return (
    <div className="flex min-w-0 items-center gap-2 border-t border-border px-3 py-2">
      <HistoryButton
        label="Undo"
        reason={props.history.undo.reason}
        enabled={props.history.undo.enabled}
        onClick={props.onUndo}
      >
        <Undo2Icon />
      </HistoryButton>
      <HistoryButton
        label="Redo"
        reason={props.history.redo.reason}
        enabled={props.history.redo.enabled}
        onClick={props.onRedo}
      >
        <Redo2Icon />
      </HistoryButton>
      <ol
        aria-label={comparing ? "Pick two versions to compare" : "Versions"}
        className="flex min-w-0 flex-1 items-stretch gap-1.5 overflow-x-auto py-0.5"
      >
        {props.items.map((item) => {
          const id = item.version.id;
          const picked = props.compared?.has(id) ?? false;
          const viewed = !comparing && id === props.viewedVersionId;
          return (
            <li key={id} className="flex shrink-0">
              <ContentButton
                variant="selection-card"
                aria-current={item.isCurrent ? "true" : undefined}
                aria-pressed={comparing ? picked : viewed}
                onClick={() => props.onView(id)}
                className="flex max-w-56 min-w-0"
              >
                {/* An undo's abandoned branch reads dimmer than the line you are on. */}
                <span
                  className={cn(
                    "flex min-w-0 items-center gap-2 px-2.5 py-1",
                    item.alternate && "opacity-70",
                  )}
                >
                  <span
                    className={cn(
                      "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-caption",
                      item.isCurrent
                        ? "bg-primary text-primary-foreground"
                        : "bg-badge-neutral text-foreground",
                    )}
                  >
                    V{item.version.ordinal}
                  </span>
                  <span className="min-w-0 truncate text-meta text-muted-foreground">
                    {item.isCurrent ? <span className="text-strong-foreground">Now </span> : null}
                    {item.version.summary ?? "No summary"}
                  </span>
                  {item.forkedFromOrdinal !== null ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 text-caption text-muted-foreground">
                      <GitBranchIcon className="size-3" aria-hidden />
                      from V{item.forkedFromOrdinal}
                    </span>
                  ) : null}
                  {item.alternate ? <span className="sr-only">(alternate branch)</span> : null}
                </span>
              </ContentButton>
            </li>
          );
        })}
      </ol>
      <Button
        variant={comparing ? "default" : "secondary"}
        size="xs"
        aria-pressed={comparing}
        disabled={props.items.length < 2}
        onClick={props.onToggleCompare}
      >
        <SplitIcon />
        {comparing ? "Done comparing" : "Compare"}
      </Button>
    </div>
  );
}

function HistoryButton(props: {
  readonly label: string;
  readonly reason: string | null;
  readonly enabled: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={props.reason === null ? props.label : `${props.label}: ${props.reason}`}
            aria-disabled={!props.enabled || undefined}
            onClick={props.enabled ? props.onClick : undefined}
          >
            {props.children}
          </Button>
        }
      />
      <TooltipPopup side="top">{props.reason ?? props.label}</TooltipPopup>
    </Tooltip>
  );
}
