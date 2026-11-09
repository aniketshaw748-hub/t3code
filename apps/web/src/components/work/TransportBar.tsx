import type { NoteMarker } from "@t3tools/client-runtime/work/markers";
import { formatTimecode } from "@t3tools/shared/deliverableNotes";
import { PauseIcon, PlayIcon } from "lucide-react";

import { MediaScrubber } from "../media/MediaTransport";
import { Button } from "../ui/button";
import { StatusDot } from "../ui/status-dot";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { noteStatusTone } from "./WorkStatusChip";

const RATES = [1, 1.5, 2, 0.5] as const;

/**
 * Flask-style transport: a round play button, `0:42 / 1:30`, the redesign's media scrubber,
 * and a dot under it for each note, coloured by its status. No editing timeline.
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
  const duration = props.duration ?? 0;
  const nextRate = RATES[(RATES.indexOf(props.rate as (typeof RATES)[number]) + 1) % RATES.length]!;
  return (
    <div className="flex items-center gap-3 px-1 pt-3">
      <Button
        variant="default"
        size="icon-sm-pill"
        aria-label={props.playing ? "Pause" : "Play"}
        onClick={props.onTogglePlay}
      >
        {props.playing ? <PauseIcon fill="currentColor" /> : <PlayIcon fill="currentColor" />}
      </Button>
      <span className="shrink-0 font-mono text-meta tabular-nums text-foreground">
        {formatTimecode(props.time)}
        <span className="text-muted-foreground"> / {formatTimecode(duration)}</span>
      </span>
      <div className="relative min-w-0 flex-1 py-2">
        <MediaScrubber
          state={{ paused: !props.playing, currentTime: props.time, duration, muted: false }}
          onSeek={props.onSeek}
          label="Playhead"
          trackClassName="bg-foreground/10"
          playedClassName="bg-strong-foreground"
        />
        <div className="pointer-events-none relative mt-1 h-2">
          {props.markers.map((marker) => (
            <Tooltip key={marker.noteIds.join(",")}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={props.markerLabel(marker)}
                    onClick={() => props.onMarker(marker)}
                    className="pointer-events-auto absolute top-0 flex -translate-x-1/2"
                    style={{ left: `${marker.position * 100}%` }}
                  >
                    <StatusDot size="md" tone={noteStatusTone(marker.status)} />
                  </button>
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
