import type { HistoryAvailability, VersionStripItem } from "@t3tools/client-runtime/work/versions";
import type { DeliverableVersionId } from "@t3tools/contracts";
import { GitBranchIcon, Redo2Icon, SplitIcon, Undo2Icon } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
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
    <div className="flex min-w-0 shrink-0 items-center gap-2 border-t border-border px-3 py-2">
      <div className="flex shrink-0 items-center gap-0.5">
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
      </div>
      <ol
        aria-label={comparing ? "Pick two versions to compare" : "Versions"}
        // The padding leaves room for a version's focus ring inside the scroller.
        className="-my-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-0.5 py-1"
      >
        {props.items.map((item) => {
          const id = item.version.id;
          const picked = props.compared?.has(id) ?? false;
          const viewed = !comparing && id === props.viewedVersionId;
          return (
            <li key={id} className="flex shrink-0">
              <Toggle
                variant="outline"
                size="segmented"
                aria-current={item.isCurrent ? "true" : undefined}
                pressed={picked || viewed}
                onPressedChange={() => props.onView(id)}
                className="max-w-60 min-w-0 justify-start"
              >
                <Badge
                  size="sm"
                  variant={item.isCurrent ? "default" : item.alternate ? "outline" : "secondary"}
                >
                  V{item.version.ordinal}
                </Badge>
                <span className="min-w-0 truncate font-normal text-muted-foreground">
                  {item.isCurrent ? "Now · " : ""}
                  {item.version.summary ?? "No summary"}
                </span>
                {item.forkedFromOrdinal !== null ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-2xs text-muted-foreground">
                    <GitBranchIcon className="size-3" aria-hidden />
                    from V{item.forkedFromOrdinal}
                  </span>
                ) : null}
                {item.alternate ? <span className="sr-only">(alternate branch)</span> : null}
              </Toggle>
            </li>
          );
        })}
      </ol>
      <Button
        variant="outline"
        size="xs"
        aria-pressed={comparing}
        data-pressed={comparing ? "" : undefined}
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
