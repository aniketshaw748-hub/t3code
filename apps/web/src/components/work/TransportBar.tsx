import type { NoteMarker } from "@t3tools/client-runtime/work/markers";
import { formatTimecode } from "@t3tools/shared/deliverableNotes";
import { PauseIcon, PlayIcon } from "lucide-react";
import { useRef } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { noteStatusDotClass } from "./WorkStatusChip";

const RATES = [1, 1.5, 2, 0.5] as const;
const KEY_STEP_SECONDS = 5;

/**
 * Flask-style transport: a round play button, `0:42 / 1:30`, a thin rail with a round handle,
 * and a dot under the rail for each note, coloured by its status. No editing timeline.
 */
export function TransportBar(props: {
  readonly playing: boolean;
  readonly time: number;
  readonly duration: number | null;
  readonly rate: number;
  readonly markers: ReadonlyArray<NoteMarker>;
  readonly markerLabel: (marker: NoteMarker) => string;
  readonly onTogglePlay: () => void;
  readonly onSeek: (seconds: number) => void;
  readonly onRate: (rate: number) => void;
  readonly onMarker: (marker: NoteMarker) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const duration = props.duration ?? 0;
  const progress = duration > 0 ? Math.min(1, props.time / duration) : 0;
  const seekFromPointer = (clientX: number) => {
    const rail = railRef.current;
    if (rail === null || duration <= 0) return;
    const rect = rail.getBoundingClientRect();
    props.onSeek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration);
  };
  const nextRate = RATES[(RATES.indexOf(props.rate as (typeof RATES)[number]) + 1) % RATES.length]!;
  return (
    <div className="flex items-center gap-3 px-1 pt-3">
      <Button
        variant="contrast"
        size="icon-sm-pill"
        aria-label={props.playing ? "Pause" : "Play"}
        onClick={props.onTogglePlay}
      >
        {props.playing ? <PauseIcon fill="currentColor" /> : <PlayIcon fill="currentColor" />}
      </Button>
      <span className="shrink-0 font-mono text-xs tabular-nums text-work-ink">
        {formatTimecode(props.time)}
        <span className="text-work-muted"> / {formatTimecode(duration)}</span>
      </span>
      <div className="relative min-w-0 flex-1 py-2">
        <div
          ref={railRef}
          role="slider"
          tabIndex={0}
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(props.time)}
          aria-valuetext={`${formatTimecode(props.time)} of ${formatTimecode(duration)}`}
          className="group relative h-4 cursor-pointer touch-none rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-work-highlight"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            seekFromPointer(event.clientX);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              seekFromPointer(event.clientX);
            }
          }}
          onKeyDown={(event) => {
            const step =
              event.key === "ArrowRight"
                ? KEY_STEP_SECONDS
                : event.key === "ArrowLeft"
                  ? -KEY_STEP_SECONDS
                  : null;
            if (step !== null) {
              event.preventDefault();
              props.onSeek(Math.min(duration, Math.max(0, props.time + step)));
            } else if (event.key === "Home") {
              event.preventDefault();
              props.onSeek(0);
            } else if (event.key === "End") {
              event.preventDefault();
              props.onSeek(duration);
            }
          }}
        >
          <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-work-line" />
          <div
            className="absolute top-1/2 left-0 h-[3px] -translate-y-1/2 rounded-full bg-work-highlight"
            style={{ width: `${progress * 100}%` }}
          />
          <div
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-work-highlight shadow-sm transition-transform group-hover:scale-125 motion-reduce:transition-none"
            style={{ left: `${progress * 100}%` }}
          />
        </div>
        <div className="pointer-events-none relative mt-1 h-2">
          {props.markers.map((marker) => (
            <Tooltip key={marker.noteIds.join(",")}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={props.markerLabel(marker)}
                    onClick={() => props.onMarker(marker)}
                    className={cn(
                      "pointer-events-auto absolute top-0 size-2 -translate-x-1/2 rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-work-highlight",
                      noteStatusDotClass(marker.status),
                    )}
                    style={{ left: `${marker.position * 100}%` }}
                  />
                }
              />
              <TooltipPopup side="bottom">{props.markerLabel(marker)}</TooltipPopup>
            </Tooltip>
          ))}
        </div>
      </div>
      <Button
        variant="ghost-muted"
        size="micro"
        aria-label={`Playback speed ${props.rate}x, change to ${nextRate}x`}
        onClick={() => props.onRate(nextRate)}
      >
        {props.rate}x
      </Button>
    </div>
  );
}
