import { containedRect, type Size } from "@t3tools/client-runtime/work/geometry";
import type { DeliverableRegion } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { View, type ViewProps } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

/**
 * The ground directly behind a video, slide or frame, and what is drawn over it. It stays the
 * same near-black in every theme, so the work's own colours are judged against one background.
 */
export const MEDIA_STAGE = {
  background: "#0a0a0a",
  ink: "#ffffff",
  muted: "rgba(255, 255, 255, 0.6)",
  chip: "rgba(0, 0, 0, 0.7)",
  outline: "rgba(255, 255, 255, 0.92)",
  outlineEdge: "rgba(0, 0, 0, 0.45)",
  outlineFill: "rgba(255, 255, 255, 0.08)",
  scrim: "rgba(0, 0, 0, 0.35)",
} as const;

export function MediaStage({ className, style, ...props }: ViewProps & { className?: string }) {
  return (
    <View
      {...props}
      className={cn("overflow-hidden rounded-xl", className)}
      style={[{ backgroundColor: MEDIA_STAGE.background }, style]}
    />
  );
}

/** Words laid over the stage where there is no media to show. */
export function MediaStageMessage(props: { readonly children: string }) {
  return (
    <View className="absolute inset-0 items-center justify-center px-3">
      <Text className="text-center text-xs" style={{ color: MEDIA_STAGE.muted }}>
        {props.children}
      </Text>
    </View>
  );
}

/** A small label laid over the media, legible on any frame. */
export function MediaStageChip(props: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <View
      className={cn("h-5 flex-row items-center gap-1 rounded-sm px-1.5", props.className)}
      style={{ backgroundColor: MEDIA_STAGE.chip }}
    >
      {props.children}
    </View>
  );
}

/**
 * A stage that letterboxes media of `aspect` and lays `overlay` exactly over the media, not its
 * bars, so a region drawn or shown at 0..1 lands on the same spot of the frame at any size.
 */
export function MediaFrame(props: {
  readonly aspect: number;
  /** Caps a tall frame, such as a portrait video, so the notes below stay on screen. */
  readonly maxHeight?: number;
  readonly children: ReactNode;
  readonly overlay?: ReactNode;
}) {
  const [size, setSize] = useState<Size | null>(null);
  const aspect = props.aspect > 0 ? props.aspect : 16 / 9;
  const box = size === null ? null : containedRect(size, aspect);
  return (
    <View
      testID="work-media-frame"
      onLayout={({ nativeEvent }) => {
        const { width, height } = nativeEvent.layout;
        if (size?.width !== width || size.height !== height) setSize({ width, height });
      }}
      className="w-full items-center justify-center"
      style={{ aspectRatio: aspect, maxHeight: props.maxHeight }}
    >
      <View
        style={
          box === null
            ? { width: "100%", height: "100%" }
            : { width: box.width, height: box.height }
        }
      >
        {props.children}
        {box === null ? null : props.overlay}
      </View>
    </View>
  );
}

/** Where a note points on a frame or slide: a white outline edged in black, to show on any frame. */
export function RegionOutline(props: {
  readonly region: DeliverableRegion;
  /** Corner grips, while the box can be dragged. */
  readonly handles?: boolean;
}) {
  const { region } = props;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute rounded-md border"
      style={{
        left: `${region.x * 100}%`,
        top: `${region.y * 100}%`,
        width: `${region.w * 100}%`,
        height: `${region.h * 100}%`,
        borderColor: MEDIA_STAGE.outlineEdge,
      }}
    >
      <View
        className="flex-1 rounded-[5px] border-2"
        style={{ borderColor: MEDIA_STAGE.outline, backgroundColor: MEDIA_STAGE.outlineFill }}
      />
      {props.handles
        ? (["top-0 left-0", "top-0 right-0", "bottom-0 left-0", "right-0 bottom-0"] as const).map(
            (corner) => (
              <View
                key={corner}
                className={cn("absolute size-3 rounded-full border", corner)}
                style={{
                  margin: -5,
                  backgroundColor: MEDIA_STAGE.ink,
                  borderColor: MEDIA_STAGE.outlineEdge,
                }}
              />
            ),
          )
        : null}
    </View>
  );
}
