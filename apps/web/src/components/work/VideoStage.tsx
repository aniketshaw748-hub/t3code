import { layoutNoteMarkers, type NoteMarker } from "@t3tools/client-runtime/work/markers";
import type { DeliverableNote, DeliverableRegion } from "@t3tools/contracts";
import { formatTimecode } from "@t3tools/shared/deliverableNotes";
import { useEffect, useRef, useState } from "react";

import { CaptureToolbar } from "./CaptureToolbar";
import { DrawOverlay, type Drawing } from "./DrawOverlay";
import { RegionOutline } from "./RegionOutline";
import { TransportBar } from "./TransportBar";
import { useContainedBox } from "./useContainedBox";

// Notes closer than this share a dot under the rail.
const MARKER_MIN_GAP = 0.012;

export interface SeekRequest {
  readonly seconds: number;
  /** Changes on every request, so seeking to the same moment twice still seeks. */
  readonly nonce: number;
}

/** The video project's canvas: a big player, its transport and the capture toolbar over it. */
export function VideoStage(props: {
  readonly sourceUrl: string | null;
  readonly posterUrl: string | null;
  readonly aspect: number;
  readonly durationSeconds: number | null;
  readonly notes: ReadonlyArray<DeliverableNote>;
  readonly seek: SeekRequest | null;
  readonly highlight: DeliverableRegion | null;
  readonly drawing: boolean;
  readonly talking: boolean;
  readonly talkAvailable: boolean;
  readonly onTime: (seconds: number) => void;
  readonly onMarker: (marker: NoteMarker) => void;
  readonly onTalk: () => void;
  readonly onDraw: () => void;
  readonly onDrawDone: (drawing: Drawing) => void;
  readonly onDrawCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [metaDuration, setMetaDuration] = useState<number | null>(null);
  const [rate, setRate] = useState(1);
  const [boxRef, box] = useContainedBox(props.aspect);
  const duration = metaDuration ?? props.durationSeconds;
  const markers = layoutNoteMarkers(props.notes, duration, MARKER_MIN_GAP);
  const { seek } = props;

  // A seek can arrive with a new version's source, before the element knows its duration.
  const pendingSeek = useRef<number | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves the media element to a moment another panel asked for
  useEffect(() => {
    const video = videoRef.current;
    if (seek === null || video === null) return;
    video.pause();
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) video.currentTime = seek.seconds;
    else pendingSeek.current = seek.seconds;
  }, [seek]);

  const seekTo = (seconds: number) => {
    const video = videoRef.current;
    if (video === null) return;
    video.currentTime = seconds;
    setTime(seconds);
    props.onTime(seconds);
  };

  const markerLabel = (marker: NoteMarker) => {
    const notes = props.notes.filter((note) => marker.noteIds.includes(note.id));
    const first = notes[0];
    const count = notes.length > 1 ? ` (+${notes.length - 1} more)` : "";
    return `${formatTimecode(marker.time)}: ${first?.body ?? "Note"}${count}`;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={boxRef} className="relative flex min-h-0 flex-1 items-center justify-center">
        <div
          className="relative overflow-hidden rounded-card bg-black"
          style={box === null ? { width: "100%", aspectRatio: props.aspect } : box}
        >
          {props.sourceUrl === null ? null : (
            <video
              ref={videoRef}
              src={props.sourceUrl}
              poster={props.posterUrl ?? undefined}
              playsInline
              preload="metadata"
              className="size-full object-contain"
              onLoadedMetadata={(event) => {
                const value = event.currentTarget.duration;
                setMetaDuration(Number.isFinite(value) ? value : null);
                if (pendingSeek.current !== null) {
                  event.currentTarget.currentTime = pendingSeek.current;
                  pendingSeek.current = null;
                }
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={(event) => {
                setTime(event.currentTarget.currentTime);
                props.onTime(event.currentTarget.currentTime);
              }}
              onSeeked={(event) => {
                setTime(event.currentTarget.currentTime);
                props.onTime(event.currentTarget.currentTime);
              }}
              onClick={(event) => {
                if (event.currentTarget.paused) void event.currentTarget.play();
                else event.currentTarget.pause();
              }}
            />
          )}
          {props.highlight !== null && !props.drawing ? (
            <RegionOutline region={props.highlight} />
          ) : null}
          {props.drawing ? (
            <DrawOverlay
              source={() => {
                const video = videoRef.current;
                return video === null || video.videoWidth === 0
                  ? null
                  : { element: video, width: video.videoWidth, height: video.videoHeight };
              }}
              onDone={props.onDrawDone}
              onCancel={props.onDrawCancel}
            />
          ) : (
            <CaptureToolbar
              talking={props.talking}
              talkAvailable={props.talkAvailable}
              onTalk={props.onTalk}
              onDraw={() => {
                videoRef.current?.pause();
                props.onDraw();
              }}
            />
          )}
        </div>
      </div>
      <TransportBar
        playing={playing}
        time={time}
        duration={duration}
        rate={rate}
        markers={markers}
        markerLabel={markerLabel}
        onTogglePlay={() => {
          const video = videoRef.current;
          if (video === null) return;
          if (video.paused) void video.play();
          else video.pause();
        }}
        onSeek={seekTo}
        onRate={(next) => {
          setRate(next);
          if (videoRef.current !== null) videoRef.current.playbackRate = next;
        }}
        onMarker={(marker) => {
          seekTo(marker.time);
          props.onMarker(marker);
        }}
      />
    </div>
  );
}
