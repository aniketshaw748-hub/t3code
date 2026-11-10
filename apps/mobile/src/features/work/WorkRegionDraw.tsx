import {
  dragRegion,
  regionGrabAt,
  type RegionGrab,
  type Size,
  type StrokePoint,
} from "@t3tools/client-runtime/work/geometry";
import type { DeliverableRegion } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { View, type GestureResponderEvent } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { MEDIA_STAGE, RegionOutline } from "./WorkMediaStage";

// How close to a corner a finger still takes hold of it, in points.
const CORNER_REACH = 28;

interface Drag {
  readonly grab: RegionGrab;
  readonly origin: DeliverableRegion | null;
  readonly start: StrokePoint;
}

/**
 * The layer a finger marks an area on. It sits exactly over the frame or slide: drag on empty
 * frame to box an area, drag the box to move it, drag a corner to resize it.
 */
export function RegionDrawSurface(props: {
  readonly region: DeliverableRegion | null;
  readonly onChange: (region: DeliverableRegion) => void;
}) {
  const [size, setSize] = useState<Size | null>(null);
  const drag = useRef<Drag | null>(null);
  // The box under the finger; the owner hears of it once, when the finger lifts.
  const [live, setLive] = useState<DeliverableRegion | null>(null);
  const shown = live ?? props.region;

  // Children take no touches, so the surface is always the target these are measured from.
  const pointAt = (event: GestureResponderEvent): StrokePoint | null =>
    size === null || size.width <= 0 || size.height <= 0
      ? null
      : {
          x: Math.min(1, Math.max(0, event.nativeEvent.locationX / size.width)),
          y: Math.min(1, Math.max(0, event.nativeEvent.locationY / size.height)),
        };
  const dragged = (event: GestureResponderEvent) => {
    const current = pointAt(event);
    return drag.current === null || current === null
      ? null
      : dragRegion({ ...drag.current, current });
  };

  return (
    <View
      accessible
      accessibilityLabel="Mark an area"
      accessibilityHint="Drag to box an area. Drag the box to move it, or a corner to resize it."
      className="absolute inset-0"
      style={{ backgroundColor: shown === null ? MEDIA_STAGE.scrim : undefined }}
      onLayout={({ nativeEvent }) =>
        setSize({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })
      }
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => {
        const start = pointAt(event);
        if (start === null || size === null) return;
        drag.current = {
          grab: regionGrabAt(props.region, start, {
            x: CORNER_REACH / size.width,
            y: CORNER_REACH / size.height,
          }),
          origin: props.region,
          start,
        };
      }}
      onResponderMove={(event) => {
        const next = dragged(event);
        if (next !== null) setLive(next);
      }}
      onResponderRelease={(event) => {
        const next = dragged(event);
        drag.current = null;
        setLive(null);
        if (next !== null) props.onChange(next);
      }}
      onResponderTerminate={() => {
        drag.current = null;
        setLive(null);
      }}
    >
      {shown === null ? null : <RegionOutline region={shown} handles />}
    </View>
  );
}

/**
 * The row under the stage while an area is being marked: what to do in words, and the ways out.
 * It takes the place of the stage's usual controls.
 */
export function RegionDrawBar(props: {
  /** `frame` for a video or image, `slide` or `page` for a deck or document. */
  readonly noun: string;
  readonly hasRegion: boolean;
  readonly onClear: () => void;
  readonly onCancel: () => void;
  readonly onDone: () => void;
}) {
  return (
    <View className="gap-1 px-4 pt-2 pb-1">
      <Text className="text-xs text-foreground-muted">
        {props.hasRegion
          ? "Drag the box to move it, or a corner to resize it."
          : `Drag on the ${props.noun} to box the area your note is about.`}
      </Text>
      <View className="flex-row items-center gap-1">
        <Button tone="text" size="compact" label="Cancel" onPress={props.onCancel} />
        <Button
          tone="text"
          size="compact"
          label="Clear"
          accessibilityLabel="Clear the marked area"
          disabled={!props.hasRegion}
          onPress={props.onClear}
        />
        <View className="flex-1" />
        <Button
          tone="primary"
          size="compact"
          icon="checkmark"
          label="Use area"
          accessibilityLabel="Pin the note to this area"
          disabled={!props.hasRegion}
          onPress={props.onDone}
        />
      </View>
    </View>
  );
}
