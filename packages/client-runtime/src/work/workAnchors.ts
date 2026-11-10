import type {
  DeliverableAnchor,
  DeliverableKind,
  DeliverableNoteAuthor,
  DeliverableRegion,
  DeliverableRendition,
  DeliverableUnitChange,
  DeliverableVersionId,
  OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { formatTimecode } from "@t3tools/shared/deliverableNotes";

const WHOLE_LABEL: Record<DeliverableKind, string> = {
  deck: "Whole deck",
  video: "Whole video",
  image: "Whole file",
  pdf: "Whole file",
  other: "Whole file",
};

/** The short chip a note card shows for where it points: `0:42`, `Slide 3`, `Area`, `Whole video`. */
export function noteAnchorChip(anchor: DeliverableAnchor | null, kind: DeliverableKind): string {
  if (anchor === null) return WHOLE_LABEL[kind];
  switch (anchor.kind) {
    case "time":
      return formatTimecode(anchor.t);
    case "slide":
      return `${kind === "pdf" ? "Page" : "Slide"} ${anchor.index + 1}`;
    case "region":
      return "Area";
  }
}

export function noteAuthorLabel(author: DeliverableNoteAuthor): string {
  return author.kind === "external" ? (author.name ?? author.source ?? "Reviewer") : "You";
}

/** What a new note would pin to now; null when nothing is pinnable. */
export interface NotePinTarget {
  readonly kind: DeliverableKind;
  readonly playheadSeconds: number;
  readonly selectedSlide: number | null;
  readonly region: DeliverableRegion | null;
}

/** `0:42`, `Slide 3`, `the marked area`, or null when a note can only be about the whole file. */
export function notePinLabel(target: NotePinTarget): string | null {
  if (target.kind === "video") return formatTimecode(target.playheadSeconds);
  if ((target.kind === "deck" || target.kind === "pdf") && target.selectedSlide !== null) {
    return `${target.kind === "pdf" ? "Page" : "Slide"} ${target.selectedSlide + 1}`;
  }
  return target.region === null ? null : "the marked area";
}

/** The anchor a new note gets: the playhead or selected slide, or the whole file when unpinned. */
export function notePinAnchor(target: NotePinTarget, pinned: boolean): DeliverableAnchor | null {
  if (!pinned || notePinLabel(target) === null) return null;
  const region = target.region ?? undefined;
  if (target.kind === "video") {
    return region === undefined
      ? { kind: "time", t: target.playheadSeconds }
      : { kind: "time", t: target.playheadSeconds, region };
  }
  if ((target.kind === "deck" || target.kind === "pdf") && target.selectedSlide !== null) {
    return region === undefined
      ? { kind: "slide", index: target.selectedSlide }
      : { kind: "slide", index: target.selectedSlide, region };
  }
  return region === undefined ? null : { kind: "region", ...region };
}

const UNIT_NOUN: Record<DeliverableKind, string> = {
  deck: "Slide",
  pdf: "Page",
  video: "Shot",
  image: "Image",
  other: "Part",
};

/** One of the two versions a comparison is between, and its rendition once loaded. */
export interface CompareSide {
  readonly versionId: DeliverableVersionId;
  readonly rendition: Pick<DeliverableRendition, "units"> | null;
}

export interface CompareSides {
  readonly base: CompareSide;
  readonly target: CompareSide;
}

type ComparedUnit = Pick<DeliverableUnitChange, "baseIndex" | "targetIndex" | "status">;

/**
 * Where a comparison row's slide or shot is found: in the newer version, or in the older one
 * once the newer no longer has it. Its number, start time and the place to open all come from
 * that version, since a removed one exists nowhere else.
 */
export function compareUnitPlace(kind: DeliverableKind, change: ComparedUnit, sides: CompareSides) {
  const side = change.targetIndex === null ? sides.base : sides.target;
  const index = change.targetIndex ?? change.baseIndex ?? 0;
  const unit = side.rendition?.units.find((candidate) => candidate.index === index);
  const moved =
    change.status === "moved" &&
    change.baseIndex !== null &&
    change.targetIndex !== null &&
    change.baseIndex !== change.targetIndex;
  const anchor: DeliverableAnchor =
    kind === "video" ? { kind: "time", t: unit?.start ?? 0 } : { kind: "slide", index };
  return {
    versionId: side.versionId,
    unit,
    /** `3`, or `3 → 5` for one that moved: where it was, then where it is. */
    position: moved ? `${change.baseIndex + 1} → ${change.targetIndex + 1}` : `${index + 1}`,
    anchor,
  };
}

/** `Slide 3`, `Slide 3 → 5` or `Shot 2 · 0:04-0:09` for one row of a comparison. */
export function compareUnitLabel(
  kind: DeliverableKind,
  change: ComparedUnit,
  sides: CompareSides,
): string {
  const { unit, position } = compareUnitPlace(kind, change, sides);
  const time =
    kind === "video" && unit?.start !== undefined && unit.end !== undefined
      ? ` · ${formatTimecode(unit.start)}-${formatTimecode(unit.end)}`
      : "";
  return `${UNIT_NOUN[kind]} ${position}${time}`;
}

export const UNIT_CHANGE_LABEL: Record<DeliverableUnitChange["status"], string> = {
  changed: "Changed",
  added: "Added",
  removed: "Removed",
  moved: "Moved",
  unchanged: "Unchanged",
};

/** The area an anchor boxes on its frame or slide, if it boxes one. */
export function anchorRegion(anchor: DeliverableAnchor | null): DeliverableRegion | null {
  if (anchor === null) return null;
  if (anchor.kind === "region") return { x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h };
  return anchor.region ?? null;
}

/** The highlighted region a comparison row points at, if it localized one. */
export function changeRegion(
  change: Pick<DeliverableUnitChange, "anchor">,
): DeliverableRegion | null {
  return anchorRegion(change.anchor);
}

/**
 * The rendered frame an anchor sits on: its slide, the shot playing at its time, or the only
 * frame of a still. Null for a whole-file anchor or when the rendition has no image for it.
 */
export function anchorFrameUrl(
  anchor: DeliverableAnchor | null,
  rendition: Pick<DeliverableRendition, "units" | "posterUrl"> | null,
): string | null {
  if (anchor === null || rendition === null) return null;
  const unit =
    anchor.kind === "slide"
      ? rendition.units.find((candidate) => candidate.index === anchor.index)
      : anchor.kind === "time"
        ? rendition.units.find(
            (candidate) =>
              candidate.start !== undefined &&
              candidate.end !== undefined &&
              anchor.t >= candidate.start &&
              anchor.t < candidate.end,
          )
        : rendition.units[0];
  // A poster is some other moment of a video, so only a still falls back to it.
  const still = anchor.kind === "region" ? rendition.posterUrl : null;
  return unit?.imageUrl ?? unit?.thumbUrl ?? still ?? null;
}

export type SpendApprovalTurnItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "spend_approval" }
>;

/** `12 credits` or `0.40 USD`. */
export function formatSpendAmount(estimate: SpendApprovalTurnItem["estimate"]): string {
  return `${Number.isInteger(estimate.amount) ? estimate.amount : estimate.amount.toFixed(2)} ${estimate.unit}`;
}

/** Service, model and settings rows an approval card lists under the cost. */
export function spendApprovalDetails(
  item: Pick<SpendApprovalTurnItem, "service" | "model" | "settings">,
): ReadonlyArray<readonly [string, string]> {
  return [
    ...(item.service === undefined ? [] : [["Service", item.service] as const]),
    ...(item.model === undefined ? [] : [["Model", item.model] as const]),
    ...Object.entries(item.settings ?? {}),
  ];
}

/** `1:30 · 1080p` for a video or `12 slides` for a deck, under the project title. */
export function renditionMeta(
  kind: DeliverableKind,
  rendition: Pick<DeliverableRendition, "durationSeconds" | "height" | "units"> | null,
): string | null {
  if (rendition === null) return null;
  if (kind === "video") {
    const parts = [
      rendition.durationSeconds === null ? null : formatTimecode(rendition.durationSeconds),
      rendition.height === null ? null : `${rendition.height}p`,
    ].filter((part) => part !== null);
    return parts.length === 0 ? null : parts.join(" · ");
  }
  if (kind === "deck" || kind === "pdf") {
    return `${rendition.units.length} ${kind === "pdf" ? "pages" : "slides"}`;
  }
  return null;
}
