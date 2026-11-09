import { layoutNoteMarkers, type NoteMarker } from "@t3tools/client-runtime/work/markers";
import type { DeliverableNote } from "@t3tools/contracts";
import { formatTimecode } from "@t3tools/shared/deliverableNotes";
import { useIsFocused } from "@react-navigation/native";
import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { Pressable, View, type GestureResponderEvent } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { useNoteStatusColors } from "./WorkStatus";

export interface SeekRequest {
  readonly seconds: number;
  readonly nonce: number;
}

// The player stage stays near-black in both themes, like any video surface.
const STAGE = { bg: "#0b0b0b", line: "#2a2a2a", ink: "#ededed", muted: "#8a8a8a" } as const;
// Dots closer than this share one marker, at any rail width a phone has.
const MARKER_MIN_GAP = 0.025;

/** The video with a Flask-style transport: play, time, a scrub rail, and note dots under it. */
export function WorkVideoStage(props: {
  readonly sourceUrl: string | null;
  readonly aspect: number;
  readonly durationSeconds: number | null;
  readonly notes: ReadonlyArray<DeliverableNote>;
  readonly seek: SeekRequest | null;
  readonly onTime: (seconds: number) => void;
  readonly onMarker: (marker: NoteMarker) => void;
}) {
  const player = useVideoPlayer(props.sourceUrl === null ? null : { uri: props.sourceUrl }, (p) => {
    p.timeUpdateEventInterval = 0.25;
    p.staysActiveInBackground = false;
  });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const time = useEvent(player, "timeUpdate", {
    currentTime: 0,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });
  const currentTime = time?.currentTime ?? 0;
  const duration =
    props.durationSeconds ??
    (Number.isFinite(player.duration) && player.duration > 0 ? player.duration : null);
  const focused = useIsFocused();
  const { onTime } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports the native player's time so a new note pins to the playhead
  useEffect(() => {
    onTime(currentTime);
  }, [currentTime, onTime]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a covered screen must not keep playing audio
  useEffect(() => {
    if (!focused) player.pause();
  }, [focused, player]);
  const seek = props.seek;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies a seek requested by a note chip or a "check it at" link to the native player
  useEffect(() => {
    if (seek === null) return;
    player.pause();
    player.seekBy(seek.seconds - player.currentTime);
  }, [seek, player]);

  const seekTo = (seconds: number) => {
    const target = Math.max(0, duration === null ? seconds : Math.min(seconds, duration));
    player.seekBy(target - player.currentTime);
  };

  return (
    <View style={{ backgroundColor: STAGE.bg }}>
      <View style={{ aspectRatio: props.aspect > 0 ? props.aspect : 16 / 9, maxHeight: 420 }}>
        {props.sourceUrl === null ? (
          <View className="flex-1 items-center justify-center">
            <Text style={{ color: STAGE.muted }} className="text-sm">
              Video unavailable
            </Text>
          </View>
        ) : (
          <VideoView
            player={player}
            nativeControls={false}
            contentFit="contain"
            style={{ flex: 1 }}
            accessibilityLabel="Video"
          />
        )}
      </View>
      <TransportBar
        playing={isPlaying}
        currentTime={currentTime}
        duration={duration}
        notes={props.notes}
        onToggle={() => (isPlaying ? player.pause() : player.play())}
        onSeek={seekTo}
        onMarker={(marker) => {
          seekTo(marker.time);
          props.onMarker(marker);
        }}
      />
    </View>
  );
}

function TransportBar(props: {
  readonly playing: boolean;
  readonly currentTime: number;
  readonly duration: number | null;
  readonly notes: ReadonlyArray<DeliverableNote>;
  readonly onToggle: () => void;
  readonly onSeek: (seconds: number) => void;
  readonly onMarker: (marker: NoteMarker) => void;
}) {
  const [width, setWidth] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const colors = useNoteStatusColors();
  const duration = props.duration;
  const shown = scrub ?? props.currentTime;
  const fraction = duration === null || duration <= 0 ? 0 : Math.min(1, shown / duration);
  const markers = layoutNoteMarkers(props.notes, duration, MARKER_MIN_GAP);
  const secondsAt = (event: GestureResponderEvent) =>
    duration === null || width <= 0
      ? 0
      : Math.max(0, Math.min(1, event.nativeEvent.locationX / width)) * duration;
  return (
    <View className="flex-row items-center gap-3 px-3 pt-2 pb-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.playing ? "Pause" : "Play"}
        onPress={props.onToggle}
        hitSlop={8}
        className="size-10 items-center justify-center rounded-full bg-white active:opacity-80"
      >
        <SymbolView name={props.playing ? "pause" : "play"} size={18} tintColor="#0b0b0b" />
      </Pressable>
      <View className="flex-1 gap-1.5">
        <View
          accessibilityRole="adjustable"
          accessibilityLabel="Playhead"
          accessibilityValue={{
            min: 0,
            max: Math.round(duration ?? 0),
            now: Math.round(shown),
            text: `${formatTimecode(shown)} of ${formatTimecode(duration ?? 0)}`,
          }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
          onAccessibilityAction={(event) =>
            props.onSeek(shown + (event.nativeEvent.actionName === "increment" ? 5 : -5))
          }
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => duration !== null}
          onMoveShouldSetResponder={() => duration !== null}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(event) => setScrub(secondsAt(event))}
          onResponderMove={(event) => setScrub(secondsAt(event))}
          onResponderRelease={(event) => {
            props.onSeek(secondsAt(event));
            setScrub(null);
          }}
          onResponderTerminate={() => setScrub(null)}
          className="h-7 justify-center"
        >
          <View
            pointerEvents="none"
            className="h-1 overflow-hidden rounded-full"
            style={{ backgroundColor: STAGE.line }}
          >
            <View className="h-1 bg-white" style={{ width: `${fraction * 100}%` }} />
          </View>
          <View
            pointerEvents="none"
            className="absolute size-3.5 rounded-full bg-white"
            style={{ left: Math.max(0, fraction * width - 7) }}
          />
        </View>
        <View className="h-3">
          {markers.map((marker) => (
            <Pressable
              key={marker.noteIds.join(",")}
              accessibilityRole="button"
              accessibilityLabel={`${marker.noteIds.length === 1 ? "Note" : `${marker.noteIds.length} notes`} at ${formatTimecode(marker.time)}`}
              hitSlop={10}
              onPress={() => props.onMarker(marker)}
              className="absolute top-0 size-2.5 rounded-full"
              style={{
                left: Math.max(0, marker.position * width - 5),
                backgroundColor: colors[marker.status],
              }}
            />
          ))}
        </View>
      </View>
      <Text style={{ color: STAGE.ink }} className="font-mono text-2xs">
        {formatTimecode(shown)}
        <Text style={{ color: STAGE.muted }}> / {formatTimecode(duration ?? 0)}</Text>
      </Text>
    </View>
  );
}
