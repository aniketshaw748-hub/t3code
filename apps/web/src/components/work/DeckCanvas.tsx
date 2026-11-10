import { mostUrgentStatus } from "@t3tools/client-runtime/work/notes";
import type {
  DeliverableNote,
  DeliverableRegion,
  DeliverableRendition,
  DeliverableRenditionUnit,
} from "@t3tools/contracts";
import { ChevronLeftIcon, ChevronRightIcon, LayoutGridIcon } from "lucide-react";
import { useRef } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { Spinner } from "../ui/spinner";
import { CaptureTools, type CaptureToolsProps } from "./CaptureTools";
import { DrawOverlay, type Drawing } from "./DrawOverlay";
import { MediaStage, MediaStageChip, MediaStageRing } from "./MediaStage";
import { RegionOutline } from "./RegionOutline";
import { useContainedBox } from "./useContainedBox";
import { noteStatusDotClass } from "./workStatus";

const notesOnSlide = (notes: ReadonlyArray<DeliverableNote>, index: number) =>
  notes.filter(
    (note) =>
      note.status !== "resolved" && note.anchor?.kind === "slide" && note.anchor.index === index,
  );

/**
 * The deck project's canvas: every slide as a card, with its notes and the agent's live work on
 * it. Opening a slide shows it large, where the stage's tools can draw on it.
 */
export function DeckCanvas(
  props: CaptureToolsProps & {
    readonly rendition: DeliverableRendition;
    readonly notes: ReadonlyArray<DeliverableNote>;
    readonly selectedSlide: number | null;
    readonly focused: boolean;
    /** The slide the agent says it is editing right now. */
    readonly workingSlide: number | null;
    readonly highlight: DeliverableRegion | null;
    readonly drawing: boolean;
    readonly assetUrl: (url: string | null) => string | null;
    readonly onSelectSlide: (index: number | null) => void;
    readonly onFocus: (focused: boolean) => void;
    readonly onDrawDone: (drawing: Drawing) => void;
    readonly onDrawCancel: () => void;
  },
) {
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
    // The padding leaves room for a slide's focus and selection rings inside the scroller.
    <div className="-m-1 min-h-0 flex-1 overflow-y-auto p-1">
      <ol
        aria-label="Slides"
        className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-4 gap-y-5"
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
                className="group cursor-pointer rounded-lg outline-none"
              >
                <MediaStage className="border border-border" style={{ aspectRatio: aspect }}>
                  {image === null ? (
                    <span className="absolute inset-0 flex items-center justify-center text-xs text-white/60">
                      Slide {unit.index + 1}
                    </span>
                  ) : (
                    <img src={image} alt="" loading="lazy" className="size-full object-contain" />
                  )}
                  {working ? (
                    <MediaStageChip className="absolute top-1.5 left-1.5">
                      <Spinner size="xs" aria-hidden />
                      Agent working on this slide
                    </MediaStageChip>
                  ) : null}
                  {notes.length > 0 ? (
                    <MediaStageChip className="absolute top-1.5 right-1.5">
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 rounded-full",
                          noteStatusDotClass(mostUrgentStatus(notes.map((note) => note.status))),
                        )}
                      />
                      {notes.length}
                    </MediaStageChip>
                  ) : null}
                  <MediaStageRing selected={isSelected} />
                </MediaStage>
              </button>
              <span className="flex min-w-0 items-baseline gap-1.5 px-0.5 text-xs">
                <span className="font-mono text-muted-foreground tabular-nums">
                  {String(unit.index + 1).padStart(2, "0")}
                </span>
                <span className="truncate text-foreground">{unit.title ?? ""}</span>
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={boxRef} className="relative flex min-h-0 flex-1 items-center justify-center">
        <MediaStage style={box === null ? { width: "100%", aspectRatio: props.aspect } : box}>
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
          ) : null}
        </MediaStage>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-2 pb-1">
        <Button variant="outline" size="xs" onClick={() => props.onFocus(false)}>
          <LayoutGridIcon />
          All slides
        </Button>
        <span className="flex-1" />
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Previous slide"
            disabled={props.drawing}
            onClick={() => props.onStep(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="px-1 font-mono text-xs text-muted-foreground tabular-nums">
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
        <Separator orientation="vertical" className="h-4" />
        <CaptureTools
          talking={props.talking}
          talkAvailable={props.talkAvailable}
          onTalk={props.onTalk}
          onDraw={props.onDraw}
        />
      </div>
    </div>
  );
}
