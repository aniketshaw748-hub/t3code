import type { ShelfStatusKind } from "@t3tools/client-runtime/work/shelf";
import type { DeliverableNoteStatus } from "@t3tools/contracts";

import { cn } from "../../lib/utils";

const NOTE_DOT: Record<DeliverableNoteStatus, string> = {
  open: "bg-work-status-open",
  fixing: "bg-work-status-fixing",
  fixed: "bg-work-status-fixed",
  resolved: "bg-work-status-resolved",
};

const NOTE_TAG: Record<DeliverableNoteStatus, string> = {
  open: "bg-work-status-open/12 text-work-status-open",
  fixing: "bg-work-status-fixing/12 text-work-status-fixing",
  fixed: "bg-work-status-fixed/14 text-work-status-fixed",
  resolved: "bg-work-status-resolved/12 text-work-status-resolved",
};

/** The colour a note status uses everywhere: its marker, its tag and its summary segment. */
export const noteStatusDotClass = (status: DeliverableNoteStatus) => NOTE_DOT[status];

/** A soft tag for a note's status. */
export function NoteStatusTag({
  status,
  children,
  className,
}: {
  readonly status: DeliverableNoteStatus;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-2xs font-medium",
        NOTE_TAG[status],
        className,
      )}
    >
      {children}
    </span>
  );
}

const SHELF_DOT: Record<ShelfStatusKind, string> = {
  waiting: "bg-work-status-open",
  rendering: "bg-work-status-fixing",
  drafting: "bg-work-status-fixing",
  failed: "bg-destructive",
  "notes-back": "bg-work-status-fixed",
  "in-review": "bg-work-status-fixed",
  final: "bg-work-status-resolved",
  ready: "bg-work-muted",
  empty: "bg-work-line",
};

/** The one plain status a project card shows. */
export function ShelfStatusChip({
  kind,
  label,
}: {
  readonly kind: ShelfStatusKind;
  readonly label: string;
}) {
  return (
    <span className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border border-work-line bg-work-panel px-2.5 text-xs text-work-ink">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", SHELF_DOT[kind])} />
      <span className="truncate">{label}</span>
    </span>
  );
}
