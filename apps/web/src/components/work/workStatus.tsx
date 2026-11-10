import type { ShelfStatusKind } from "@t3tools/client-runtime/work/shelf";
import type { DeliverableNoteStatus } from "@t3tools/contracts";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

/**
 * How a status reads in Work: a dot and its words in one colour, the way the sidebar shows a
 * thread's status in Code mode. The colours are the same ones, so "working" or "needs you" look
 * alike wherever they appear.
 */
type StatusTone = "attention" | "input" | "working" | "review" | "done" | "failed" | "quiet";

const TONE: Record<
  StatusTone,
  { readonly text: string; readonly dot: string; readonly pulse: boolean }
> = {
  attention: {
    text: "text-amber-600 dark:text-amber-300/90",
    dot: "bg-amber-500 dark:bg-amber-300/90",
    pulse: false,
  },
  input: {
    text: "text-indigo-600 dark:text-indigo-300/90",
    dot: "bg-indigo-500 dark:bg-indigo-300/90",
    pulse: false,
  },
  working: {
    text: "text-sky-600 dark:text-sky-300/80",
    dot: "bg-sky-500 dark:bg-sky-300/80",
    pulse: true,
  },
  review: {
    text: "text-violet-600 dark:text-violet-300/90",
    dot: "bg-violet-500 dark:bg-violet-300/90",
    pulse: false,
  },
  done: {
    text: "text-emerald-600 dark:text-emerald-300/90",
    dot: "bg-emerald-500 dark:bg-emerald-300/90",
    pulse: false,
  },
  failed: {
    text: "text-red-600 dark:text-red-300/90",
    dot: "bg-red-500 dark:bg-red-300/90",
    pulse: false,
  },
  quiet: { text: "text-muted-foreground", dot: "bg-muted-foreground/60", pulse: false },
};

const NOTE_TONE: Record<DeliverableNoteStatus, StatusTone> = {
  open: "attention",
  fixing: "working",
  fixed: "review",
  resolved: "done",
};

const SHELF_TONE: Record<ShelfStatusKind, StatusTone> = {
  waiting: "input",
  rendering: "working",
  working: "working",
  failed: "failed",
  "notes-back": "attention",
  "in-review": "review",
  final: "done",
  "notes-open": "attention",
  "notes-fixing": "working",
  "notes-fixed": "review",
  resolved: "done",
  ready: "quiet",
  empty: "quiet",
};

/** The colour a note status uses everywhere: its marker, its label and its summary segment. */
export const noteStatusDotClass = (status: DeliverableNoteStatus) => TONE[NOTE_TONE[status]].dot;

function StatusDot({ tone }: { readonly tone: StatusTone }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        TONE[tone].dot,
        TONE[tone].pulse && "motion-safe:animate-status-pulse",
      )}
    />
  );
}

function StatusLabel(props: {
  readonly tone: StatusTone;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-xs",
        TONE[props.tone].text,
        props.className,
      )}
    >
      <StatusDot tone={props.tone} />
      <span className="min-w-0 truncate">{props.children}</span>
    </span>
  );
}

/** A note's status in words: `Open`, `Agent fixing`, `Fixed in V4`, `Resolved`. */
export function NoteStatusLabel(props: {
  readonly status: DeliverableNoteStatus;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <StatusLabel tone={NOTE_TONE[props.status]} className={props.className}>
      {props.children}
    </StatusLabel>
  );
}

/** A Work project's status in words: `Agent working`, `2 notes open`, `All notes resolved`. */
export function ShelfStatusLabel(props: {
  readonly kind: ShelfStatusKind;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <StatusLabel tone={SHELF_TONE[props.kind]} className={props.className}>
      {props.label}
    </StatusLabel>
  );
}

/** Just the dot, for rows too tight for the words; pair it with a screen-reader label. */
export function ShelfStatusDot({ kind }: { readonly kind: ShelfStatusKind }) {
  return <StatusDot tone={SHELF_TONE[kind]} />;
}
