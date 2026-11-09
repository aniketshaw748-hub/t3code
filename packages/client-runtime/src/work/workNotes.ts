import type {
  DeliverableAnchor,
  DeliverableNote,
  DeliverableNoteStatus,
  DeliverableVersionId,
} from "@t3tools/contracts";
import { formatTimecode } from "@t3tools/shared/deliverableNotes";

/** Display order for the summary bar: what needs the user first. */
const NOTE_STATUS_ORDER: ReadonlyArray<DeliverableNoteStatus> = [
  "open",
  "fixed",
  "fixing",
  "resolved",
];

const NOTE_STATUS_RANK: Record<DeliverableNoteStatus, number> = {
  open: 0,
  fixed: 1,
  fixing: 2,
  resolved: 3,
};

export interface NoteCheckTarget {
  readonly versionId: DeliverableVersionId;
  readonly versionOrdinal: number;
  readonly anchor: DeliverableAnchor | null;
}

export interface NoteDisplay {
  readonly status: DeliverableNoteStatus;
  /** One plain tag, such as `Open`, `Agent fixing` or `Fixed in V4`. */
  readonly label: string;
  /** Where to look to check the agent's fix, when it made one. */
  readonly check: NoteCheckTarget | null;
}

type DisplayNote = Pick<
  DeliverableNote,
  "status" | "sentRunId" | "fixedInVersionId" | "checkAnchor" | "anchor"
>;

export function noteDisplay(
  note: DisplayNote,
  ordinalOf: (versionId: DeliverableVersionId) => number | undefined,
): NoteDisplay {
  switch (note.status) {
    case "open":
      return { status: "open", label: "Open", check: null };
    case "fixing":
      return {
        status: "fixing",
        label: note.sentRunId === null ? "Sent to agent" : "Agent fixing",
        check: null,
      };
    case "resolved":
      return { status: "resolved", label: "Resolved", check: null };
    case "fixed": {
      const ordinal = note.fixedInVersionId === null ? undefined : ordinalOf(note.fixedInVersionId);
      if (note.fixedInVersionId === null || ordinal === undefined) {
        return { status: "fixed", label: "Fixed", check: null };
      }
      return {
        status: "fixed",
        label: `Fixed in V${ordinal}`,
        check: {
          versionId: note.fixedInVersionId,
          versionOrdinal: ordinal,
          anchor: note.checkAnchor ?? note.anchor,
        },
      };
    }
  }
}

/** `Check it at 0:12 in V4`, `Check slide 3 in V4` or `Check it in V4`. */
export function checkLinkLabel(check: NoteCheckTarget): string {
  const anchor = check.anchor;
  const where =
    anchor === null
      ? "it"
      : anchor.kind === "time"
        ? `it at ${formatTimecode(anchor.t)}`
        : anchor.kind === "slide"
          ? `slide ${anchor.index + 1}`
          : "it";
  return `Check ${where} in V${check.versionOrdinal}`;
}

export interface NoteSummarySegment {
  readonly status: DeliverableNoteStatus;
  readonly count: number;
  readonly label: string;
}

const SUMMARY_LABEL: Record<DeliverableNoteStatus, (count: number) => string> = {
  open: (count) => `${count} open`,
  fixed: (count) => `${count} fixed, check ${count === 1 ? "it" : "them"}`,
  fixing: (count) => `${count} agent fixing`,
  resolved: (count) => `${count} resolved`,
};

/** Non-empty status segments for the summary bar, in `NOTE_STATUS_ORDER`. */
export function notesSummary(
  notes: ReadonlyArray<Pick<DeliverableNote, "status">>,
): ReadonlyArray<NoteSummarySegment> {
  return NOTE_STATUS_ORDER.flatMap((status) => {
    const count = notes.filter((note) => note.status === status).length;
    return count === 0 ? [] : [{ status, count, label: SUMMARY_LABEL[status](count) }];
  });
}

/** Seconds or slide index a note sorts by; whole-deliverable notes sort last. */
function anchorPosition(anchor: DeliverableAnchor | null): number {
  if (anchor === null) return Number.POSITIVE_INFINITY;
  switch (anchor.kind) {
    case "time":
      return anchor.t;
    case "slide":
      return anchor.index;
    case "region":
      return 0;
  }
}

/** Unresolved notes in the order they appear in the work, then resolved ones, newest first. */
export function sortNotes<
  N extends Pick<DeliverableNote, "status" | "anchor" | "createdAt" | "id">,
>(notes: ReadonlyArray<N>): ReadonlyArray<N> {
  return [...notes].sort((a, b) => {
    const resolvedA = a.status === "resolved";
    const resolvedB = b.status === "resolved";
    if (resolvedA !== resolvedB) return resolvedA ? 1 : -1;
    if (resolvedA) return b.createdAt.epochMilliseconds - a.createdAt.epochMilliseconds;
    const positionA = anchorPosition(a.anchor);
    const positionB = anchorPosition(b.anchor);
    if (positionA !== positionB) return positionA < positionB ? -1 : 1;
    return a.createdAt.epochMilliseconds - b.createdAt.epochMilliseconds;
  });
}

/** The most urgent status among several notes, for a marker that stands for all of them. */
export function mostUrgentStatus(
  statuses: ReadonlyArray<DeliverableNoteStatus>,
): DeliverableNoteStatus {
  return statuses.reduce<DeliverableNoteStatus>(
    (best, status) => (NOTE_STATUS_RANK[status] < NOTE_STATUS_RANK[best] ? status : best),
    "resolved",
  );
}

export interface AgentProgress {
  /** `Slide 4 of 9`, from the agent's own words. */
  readonly step: string | null;
  /** A render percentage the agent reported, 0-100. */
  readonly renderPercent: number | null;
}

const STEP_PATTERN =
  /\b(slide|shot|scene|page|image|frame|clip)\s+(\d{1,4})\s*(?:of|\/)\s*(\d{1,4})\b/gi;
const RENDER_PATTERN = /render\w*[^.\n%]{0,40}?(\d{1,3}(?:\.\d+)?)\s?%/gi;

/** What the agent says it is on, read from its latest message; null when it says nothing usable. */
export function agentProgress(text: string | null): AgentProgress {
  if (text === null) return { step: null, renderPercent: null };
  const steps = [...text.matchAll(STEP_PATTERN)];
  const step = steps.at(-1);
  const renders = [...text.matchAll(RENDER_PATTERN)];
  const render = renders.at(-1);
  const percent = render === undefined ? null : Number(render[1]);
  const unit = step?.[1];
  return {
    step:
      step === undefined || unit === undefined
        ? null
        : `${unit[0]!.toUpperCase()}${unit.slice(1).toLowerCase()} ${step[2]} of ${step[3]}`,
    renderPercent:
      percent === null || !Number.isFinite(percent) || percent > 100 ? null : Math.round(percent),
  };
}
