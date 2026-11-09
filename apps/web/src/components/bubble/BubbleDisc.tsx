import type { DesktopBubbleEdge } from "@t3tools/contracts";
import type { PointerEventHandler } from "react";

import { cn } from "~/lib/utils";
import type { BubbleStackSummary, BubbleThreadTone } from "./bubbleThreads.logic";

const RING_RADIUS = 26;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
/** How far each disc behind the front one peeks out, toward the open side of the screen. */
const STACK_OFFSETS = [0, 6, 8] as const;

const TONE_RING: Record<BubbleThreadTone | "idle", string> = {
  attention: "stroke-warning",
  working: "stroke-info",
  failed: "stroke-destructive",
  done: "stroke-success",
  idle: "stroke-transparent",
};

const TONE_EDGE: Record<BubbleThreadTone, string> = {
  attention: "border-warning/70",
  working: "border-info/50",
  failed: "border-destructive/60",
  done: "border-success/60",
};

function ringFraction(summary: BubbleStackSummary): number {
  if (summary.tone === "attention") return 1;
  // A sliver keeps a working stack readable as live before anything has finished.
  return summary.count === 0 ? 0 : Math.max(summary.progress, 0.08);
}

export function BubbleDisc(props: {
  readonly summary: BubbleStackSummary;
  readonly horizontal: DesktopBubbleEdge;
  readonly vertical: DesktopBubbleEdge;
  readonly label: string;
  readonly onPointerDown: PointerEventHandler<HTMLButtonElement>;
  readonly onPointerMove: PointerEventHandler<HTMLButtonElement>;
  readonly onPointerUp: PointerEventHandler<HTMLButtonElement>;
  readonly onPointerCancel: PointerEventHandler<HTMLButtonElement>;
}) {
  const { summary } = props;
  const dx = props.horizontal === "end" ? -1 : 1;
  const dy = props.vertical === "end" ? -1 : 1;
  const behind = summary.discs.slice(1);
  const fraction = ringFraction(summary);
  return (
    <button
      type="button"
      data-bubble-hit
      aria-label={props.label}
      className="relative size-16 shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
    >
      {behind.toReversed().map((tone, index) => {
        const offset = STACK_OFFSETS[behind.length - index] ?? 0;
        return (
          <span
            key={`${behind.length - index}`}
            aria-hidden
            className={cn(
              "absolute inset-2 rounded-full border-2 bg-popover shadow-md",
              TONE_EDGE[tone],
              behind.length - index === 1 ? "opacity-95" : "opacity-70",
            )}
            style={{ translate: `${dx * offset}px ${dy * offset}px` }}
          />
        );
      })}
      <span
        data-front
        key={summary.attentionCount}
        aria-hidden
        className={cn(
          "absolute inset-2 flex items-center justify-center rounded-full surface-popover",
          summary.attentionCount > 0 && "motion-safe:animate-bubble-nudge",
        )}
      >
        <img
          src="/apple-touch-icon.png"
          alt=""
          draggable={false}
          className="size-7 rounded-lg object-contain"
        />
      </span>
      <svg
        aria-hidden
        viewBox="0 0 64 64"
        className="pointer-events-none absolute inset-0 size-16 -rotate-90"
      >
        <circle
          cx="32"
          cy="32"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="3"
          className={summary.count === 0 ? "stroke-transparent" : "stroke-border/70"}
        />
        <circle
          cx="32"
          cy="32"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - fraction)}
          className={cn(
            TONE_RING[summary.tone],
            "transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none",
          )}
        />
      </svg>
      {summary.count > 1 || summary.attentionCount > 0 ? (
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-caption tabular-nums shadow-sm ring-2 ring-popover",
            props.horizontal === "end" ? "left-0.5" : "right-0.5",
            summary.attentionCount > 0
              ? "bg-warning text-black"
              : "bg-primary text-primary-foreground",
          )}
        >
          {summary.attentionCount > 0 && summary.count === 1 ? "!" : summary.count}
        </span>
      ) : null}
    </button>
  );
}
