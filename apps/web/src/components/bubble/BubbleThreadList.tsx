import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { formatWorkingDurationLabel } from "@t3tools/client-runtime/state/models";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useState } from "react";

import { APP_DISPLAY_NAME } from "~/branding";
import { useNowSecond } from "~/hooks/useNowSecond";
import { cn } from "~/lib/utils";
import { useQuietThreadVisibleTurnItems } from "~/state/entities";
import { Button } from "../ui/button";
import { deriveThreadProgressReport } from "./bubbleProgress.logic";
import type { BubbleThread, BubbleThreadTone } from "./bubbleThreads.logic";

function BubbleToneIcon({
  tone,
  className,
}: {
  readonly tone: BubbleThreadTone;
  readonly className?: string;
}) {
  const iconClassName = cn("size-3.5 shrink-0", className);
  switch (tone) {
    case "attention":
      return <ShieldQuestionIcon aria-hidden className={cn(iconClassName, "text-warning")} />;
    case "working":
      return <CircleDotIcon aria-hidden className={cn(iconClassName, "text-primary")} />;
    case "failed":
      return <CircleAlertIcon aria-hidden className={cn(iconClassName, "text-destructive")} />;
    case "done":
      return <CircleCheckIcon aria-hidden className={cn(iconClassName, "text-success")} />;
  }
}

/** Elapsed time, ticking only while a report is on screen. */
export function ElapsedLabel({ since }: { readonly since: string }) {
  const now = useNowSecond();
  return (
    <span className="tabular-nums">{formatWorkingDurationLabel(now - Date.parse(since))}</span>
  );
}

function ThreadReport({ thread }: { readonly thread: BubbleThread }) {
  const items = useQuietThreadVisibleTurnItems(
    scopeThreadRef(thread.environmentId, thread.threadId),
  );
  const report = deriveThreadProgressReport(items);
  const hasTiming = thread.workingSince !== null || report.plan !== null;
  return (
    <span className="flex flex-col gap-1 pt-1.5 pb-0.5 ps-5.5 text-2xs leading-4 text-muted-foreground">
      {report.steps.length === 0 && report.current === null ? (
        <span className="block italic">No steps yet</span>
      ) : null}
      {report.steps.map((step) => (
        <span key={step.id} className={cn("block truncate", step.failed && "text-destructive")}>
          <span aria-hidden className="me-1.5 opacity-60">
            ✓
          </span>
          {step.label}
        </span>
      ))}
      {report.current ? (
        <span className="block truncate font-medium text-foreground">
          <span aria-hidden className="me-1.5 text-primary">
            ›
          </span>
          {report.current}
        </span>
      ) : null}
      {hasTiming ? (
        <span className="flex gap-2 tabular-nums opacity-80">
          {thread.workingSince !== null ? (
            <span>
              Working for <ElapsedLabel since={thread.workingSince} />
            </span>
          ) : null}
          {report.plan ? (
            <span>
              Plan {report.plan.completed}/{report.plan.total}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

function ThreadRow(props: {
  readonly thread: BubbleThread;
  readonly expanded: boolean;
  readonly onHover: () => void;
  readonly onOpen: () => void;
}) {
  const { thread } = props;
  return (
    <li>
      {/* A row, not a control a primitive provides: it grows to show the report on hover. */}
      <button
        type="button"
        className={cn(
          "flex w-full flex-col rounded-lg px-2 py-1.5 text-start outline-none transition-colors duration-150 hover:bg-accent focus-visible:bg-accent motion-reduce:transition-none",
          thread.tone === "attention" && "bg-warning/8",
        )}
        onPointerEnter={props.onHover}
        onFocus={props.onHover}
        onClick={props.onOpen}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <BubbleToneIcon tone={thread.tone} />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {thread.title}
          </span>
          <span
            className={cn(
              "shrink-0 text-2xs",
              thread.tone === "attention" ? "font-medium text-warning" : "text-muted-foreground",
            )}
          >
            {thread.statusLabel}
          </span>
        </span>
        <span className="mt-0.5 flex w-full min-w-0 gap-1 ps-5.5 text-2xs text-muted-foreground">
          {thread.projectTitle ? (
            <span className="max-w-[40%] shrink-0 truncate opacity-80">
              {thread.projectTitle} ·
            </span>
          ) : null}
          <span className="min-w-0 truncate">{thread.nowLine}</span>
        </span>
        <span
          className={cn(
            "grid w-full transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
            props.expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <span className="min-h-0 overflow-hidden">
            {props.expanded ? <ThreadReport thread={thread} /> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

export function BubbleThreadList(props: {
  readonly threads: ReadonlyArray<BubbleThread>;
  readonly onOpenThread: (thread: BubbleThread) => void;
  readonly onRestoreApp: () => void;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const attentionCount = props.threads.filter((thread) => thread.tone === "attention").length;
  return (
    <div className="flex max-h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 ps-3 pe-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
          {props.threads.length === 0
            ? "No agents running"
            : `${props.threads.length} ${props.threads.length === 1 ? "agent" : "agents"}`}
          {attentionCount > 0 ? (
            <span className="ms-1.5 font-medium text-warning">· {attentionCount} need you</span>
          ) : null}
        </span>
        <Button
          variant="ghost-muted"
          size="compact"
          aria-label={`Open ${APP_DISPLAY_NAME}`}
          onClick={props.onRestoreApp}
        >
          <ExternalLinkIcon />
          Open app
        </Button>
      </div>
      {props.threads.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          Threads you start show up here while they run.
        </p>
      ) : (
        <ul
          className="min-h-0 flex-1 overflow-y-auto p-1"
          onPointerLeave={() => setHoveredKey(null)}
        >
          {props.threads.map((thread) => (
            <ThreadRow
              key={thread.key}
              thread={thread}
              expanded={hoveredKey === thread.key}
              onHover={() => setHoveredKey(thread.key)}
              onOpen={() => props.onOpenThread(thread)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
