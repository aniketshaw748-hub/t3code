import type { ShelfStatusKind } from "@t3tools/client-runtime/work/shelf";
import type { DeliverableNoteStatus } from "@t3tools/contracts";

import { Badge } from "../ui/badge";
import { StatusDot, type StatusDotTone } from "../ui/status-dot";

/** The status hue each note status takes: open waits on the agent, fixed waits on you. */
const NOTE_TONE = {
  open: "warning",
  fixing: "info",
  fixed: "merged",
  resolved: "success",
} as const satisfies Record<DeliverableNoteStatus, StatusDotTone>;

const NOTE_DOT: Record<DeliverableNoteStatus, string> = {
  open: "bg-warning",
  fixing: "bg-info",
  fixed: "bg-merged",
  resolved: "bg-success",
};

/** The colour a note status uses everywhere: its marker, its tag and its summary segment. */
export const noteStatusDotClass = (status: DeliverableNoteStatus) => NOTE_DOT[status];

export const noteStatusTone = (status: DeliverableNoteStatus): StatusDotTone => NOTE_TONE[status];

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
    <Badge variant={NOTE_TONE[status]} className={className}>
      {children}
    </Badge>
  );
}

const SHELF_TONE: Record<ShelfStatusKind, StatusDotTone> = {
  waiting: "warning",
  rendering: "info",
  drafting: "info",
  failed: "danger",
  "notes-back": "merged",
  "in-review": "merged",
  final: "success",
  ready: "neutral",
  empty: "neutral",
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
    <Badge variant="secondary" size="lg" className="max-w-full">
      <StatusDot tone={SHELF_TONE[kind]} />
      <span className="truncate">{label}</span>
    </Badge>
  );
}
