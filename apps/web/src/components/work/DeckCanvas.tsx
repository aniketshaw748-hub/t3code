import { mostUrgentStatus } from "@t3tools/client-runtime/work/notes";
import type {
  DeliverableNote,
  DeliverableRegion,
  DeliverableRendition,
  DeliverableRenditionUnit,
} from "@t3tools/contracts";
import { ChevronLeftIcon, ChevronRightIcon, LayoutGridIcon, LoaderIcon } from "lucide-react";
import { useRef } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { CaptureToolbar } from "./CaptureToolbar";
import { DrawOverlay, type Drawing } from "./DrawOverlay";
import { RegionOutline } from "./RegionOutline";
import { useContainedBox } from "./useContainedBox";
import { noteStatusDotClass } from "./WorkStatusChip";

const notesOnSlide = (notes: ReadonlyArray<DeliverableNote>, index: number) =>
  notes.filter(
    (note) =>
      note.status !== "resolved" && note.anchor?.kind === "slide" && note.anchor.index === index,
  );

/**
 * The deck project's canvas: every slide as a card, with its notes and the agent's live work on
 * it. Opening a slide shows it large, where the capture toolbar can draw on it.
 */
export function DeckCanvas(props: {
  readonly rendition: DeliverableRendition;
  readonly notes: ReadonlyArray<DeliverableNote>;
  readonly selectedSlide: number | null;
  readonly focused: boolean;
  /** The slide the agent says it is editing right now. */
  readonly workingSlide: number | null;
  readonly highlight: DeliverableRegion | null;
  readonly drawing: boolean;
  readonly talking: boolean;
  readonly talkAvailable: boolean;
  readonly assetUrl: (url: string | null) => string | null;
  readonly onSelectSlide: (index: number | null) => void;
  readonly onFocus: (focused: boolean) => void;
  readonly onTalk: () => void;
  readonly onDraw: () => void;
  readonly onDrawDone: (drawing: Drawing) => void;
  readonly onDrawCancel: () => void;
}) {
  const units = props.rendition.units;
  const aspect =
    props.rendition.width !== null && props.rendition.height !== null && props.rendition.height > 0
      ? props.rendition.width / props.rendition.height
      : 16 / 9;
  const selected = units.find((unit) => unit.index === props.selectedSlide) ?? null;
  if ((props.focused || props.drawing) && selected !== null) {
    return (
      <FocusedSlide
        unit={selected}
        count={units.length}
        aspect={aspect}
        {...props}
        onStep={(delta) => {
          const position = units.findIndex((unit) => unit.index === selected.index) + delta;
          const next = units[Math.min(units.length - 1, Math.max(0, position))];
          if (next !== undefined) props.onSelectSlide(next.index);
        }}
      />
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      <ol
        aria-label="Slides"
        className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4 pb-2"
      >
        {units.map((unit) => {
          const notes = notesOnSlide(props.notes, unit.index);
          const isSelected = unit.index === props.selectedSlide;
          const working = unit.index === props.workingSlide;
          const image = props.assetUrl(unit.thumbUrl ?? unit.imageUrl);
          return (
            <li key={unit.index} className="flex flex-col gap-1.5">
              <button
                type="button"
                aria-pressed={isSelected}
                aria-label={`Slide ${unit.index + 1}${unit.title ? `: ${unit.title}` : ""}${notes.length > 0 ? `, ${notes.length} open notes` : ""}`}
                onClick={() => props.onSelectSlide(isSelected ? null : unit.index)}
                onDoubleClick={() => {
                  props.onSelectSlide(unit.index);
                  props.onFocus(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && isSelected) {
                    event.preventDefault();
                    props.onFocus(true);
                  }
                }}
                className={cn(
                  "relative overflow-hidden rounded-lg border bg-work-panel outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-work-highlight",
                  isSelected
                    ? "border-work-highlight ring-1 ring-work-highlight"
                    : "border-work-line",
                )}
                style={{ aspectRatio: aspect }}
              >
                {image === null ? (
                  <span className="absolute inset-0 flex items-center justify-center text-xs text-work-muted">
                    Slide {unit.index + 1}
                  </span>
                ) : (
                  <img src={image} alt="" loading="lazy" className="size-full object-contain" />
                )}
                {working ? (
                  <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/75 px-2 py-0.5 text-2xs text-white">
                    <LoaderIcon className="size-3 motion-safe:animate-spin" aria-hidden />
                    Agent working on this slide
                  </span>
                ) : null}
                {notes.length > 0 ? (
                  <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/75 px-1.5 py-0.5 text-2xs text-white">
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 rounded-full",
                        noteStatusDotClass(mostUrgentStatus(notes.map((note) => note.status))),
                      )}
                    />
                    {notes.length}
                  </span>
                ) : null}
              </button>
              <span className="flex min-w-0 items-baseline gap-1.5 px-0.5 text-xs">
                <span className="font-mono text-work-muted tabular-nums">
                  {String(unit.index + 1).padStart(2, "0")}
                </span>
                <span className="truncate text-work-ink">{unit.title ?? ""}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function FocusedSlide(
  props: Parameters<typeof DeckCanvas>[0] & {
    readonly unit: DeliverableRenditionUnit;
    readonly count: number;
    readonly aspect: number;
    readonly onStep: (delta: number) => void;
  },
) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [boxRef, box] = useContainedBox(props.aspect);
  const image = props.assetUrl(props.unit.imageUrl ?? props.unit.thumbUrl);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="xs" onClick={() => props.onFocus(false)}>
          <LayoutGridIcon />
          All slides
        </Button>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Previous slide"
          disabled={props.drawing}
          onClick={() => props.onStep(-1)}
        >
          <ChevronLeftIcon />
        </Button>
        <span className="font-mono text-xs text-work-muted tabular-nums">
          {props.unit.index + 1} / {props.count}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Next slide"
          disabled={props.drawing}
          onClick={() => props.onStep(1)}
        >
          <ChevronRightIcon />
        </Button>
      </div>
      <div ref={boxRef} className="relative flex min-h-0 flex-1 items-center justify-center">
        <div
          className="relative overflow-hidden rounded-xl border border-work-line bg-work-panel"
          style={box === null ? { width: "100%", aspectRatio: props.aspect } : box}
        >
          {image === null ? null : (
            <img
              ref={imageRef}
              src={image}
              alt={`Slide ${props.unit.index + 1}`}
              className="size-full object-contain"
            />
          )}
          {props.highlight !== null && !props.drawing ? (
            <RegionOutline region={props.highlight} />
          ) : null}
          {props.drawing ? (
            <DrawOverlay
              source={() => {
                const element = imageRef.current;
                return element === null || element.naturalWidth === 0
                  ? null
                  : { element, width: element.naturalWidth, height: element.naturalHeight };
              }}
              onDone={props.onDrawDone}
              onCancel={props.onDrawCancel}
            />
          ) : (
            <CaptureToolbar
              talking={props.talking}
              talkAvailable={props.talkAvailable}
              onTalk={props.onTalk}
              onDraw={props.onDraw}
            />
          )}
        </div>
      </div>
    </div>
  );
}
