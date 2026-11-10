import { mostUrgentStatus } from "@t3tools/client-runtime/work/notes";
import type { DeliverableNote, DeliverableRegion, DeliverableRendition } from "@t3tools/contracts";
import { Image } from "expo-image";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { IconButton } from "../../components/ui/IconButton";
import { cn } from "../../lib/cn";
import { MEDIA_STAGE, MediaStage, MediaStageChip, MediaStageMessage } from "./WorkMediaStage";
import { MarkAreaButton, WorkStage, type StageMarking } from "./WorkStage";
import { noteStatusFillClassName } from "./WorkStatus";

type AssetUrl = (url: string | null | undefined) => string | null;

export const renditionAspect = (
  rendition: Pick<DeliverableRendition, "width" | "height">,
  fallback: number,
) =>
  rendition.width !== null && rendition.height !== null && rendition.height > 0
    ? rendition.width / rendition.height
    : fallback;

const notesOnSlide = (notes: ReadonlyArray<DeliverableNote>, index: number) =>
  notes.filter(
    (note) =>
      note.status !== "resolved" && note.anchor?.kind === "slide" && note.anchor.index === index,
  );

/** The picked slide or page, large, with previous and next and a way to mark an area on it. */
export function WorkSlideStage(props: {
  readonly rendition: DeliverableRendition;
  readonly noun: "Slide" | "Page";
  readonly selectedSlide: number;
  readonly highlight: DeliverableRegion | null;
  readonly marking: StageMarking;
  readonly assetUrl: AssetUrl;
  readonly onSelectSlide: (index: number | null) => void;
}) {
  const units = props.rendition.units;
  const position = units.findIndex((unit) => unit.index === props.selectedSlide);
  const unit = units[position];
  if (unit === undefined) return null;
  const noun = props.noun.toLowerCase();
  const image = props.assetUrl(unit.imageUrl ?? unit.thumbUrl);
  const step = (delta: number) => props.onSelectSlide(units[position + delta]?.index ?? null);
  return (
    <WorkStage
      aspect={renditionAspect(props.rendition, 16 / 9)}
      noun={noun}
      highlight={props.highlight}
      marking={props.marking}
      controls={
        <View className="flex-row items-center gap-1 px-4 pt-2 pb-1">
          <IconButton
            variant="tonal"
            icon="square.grid.2x2"
            accessibilityLabel={`Back to all ${noun}s`}
            onPress={() => props.onSelectSlide(null)}
          />
          <View className="flex-1" />
          <IconButton
            icon="chevron.left"
            accessibilityLabel={`Previous ${noun}`}
            disabled={position <= 0}
            onPress={() => step(-1)}
          />
          <Text
            accessibilityLabel={`${props.noun} ${unit.index + 1} of ${units.length}`}
            numberOfLines={1}
            className="shrink px-1 font-mono text-xs text-foreground-muted"
          >
            {unit.index + 1} / {units.length}
          </Text>
          <IconButton
            icon="chevron.right"
            accessibilityLabel={`Next ${noun}`}
            disabled={position >= units.length - 1}
            onPress={() => step(1)}
          />
          <View className="flex-1" />
          <MarkAreaButton marking={props.marking} />
        </View>
      }
    >
      {image === null ? (
        <MediaStageMessage>{`${props.noun} ${unit.index + 1}`}</MediaStageMessage>
      ) : (
        <Image
          source={{ uri: image }}
          contentFit="contain"
          style={{ flex: 1 }}
          accessibilityLabel={`${props.noun} ${unit.index + 1}${unit.title ? `: ${unit.title}` : ""}`}
        />
      )}
    </WorkStage>
  );
}

/**
 * Every slide or page as a small card. A card with open notes carries their count, coloured by
 * the most urgent one, and the card the agent says it is editing says so.
 */
export function WorkSlideGrid(props: {
  readonly rendition: DeliverableRendition;
  readonly notes: ReadonlyArray<DeliverableNote>;
  readonly noun: "Slide" | "Page";
  readonly selectedSlide: number | null;
  readonly workingSlide: number | null;
  readonly assetUrl: AssetUrl;
  readonly onSelectSlide: (index: number | null) => void;
}) {
  const aspect = renditionAspect(props.rendition, 16 / 9);
  return (
    <View accessibilityLabel={`${props.noun}s`} className="flex-row flex-wrap gap-x-2 gap-y-3">
      {props.rendition.units.map((unit) => {
        const notes = notesOnSlide(props.notes, unit.index);
        const selected = unit.index === props.selectedSlide;
        const working = unit.index === props.workingSlide;
        const image = props.assetUrl(unit.thumbUrl ?? unit.imageUrl);
        return (
          <Pressable
            key={unit.index}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${props.noun} ${unit.index + 1}${unit.title ? `: ${unit.title}` : ""}${notes.length > 0 ? `, ${notes.length} open notes` : ""}${working ? ", the agent is working on it" : ""}`}
            onPress={() => props.onSelectSlide(selected ? null : unit.index)}
            className="basis-[31%] grow-0 gap-1 active:opacity-80"
          >
            <MediaStage
              className={cn(
                "rounded-lg border",
                selected ? "border-2 border-primary" : "border-border",
              )}
              style={{ aspectRatio: aspect }}
            >
              {image === null ? (
                <MediaStageMessage>{`${props.noun} ${unit.index + 1}`}</MediaStageMessage>
              ) : (
                <Image
                  source={{ uri: image }}
                  contentFit="contain"
                  recyclingKey={`${props.rendition.versionId}:${unit.index}`}
                  style={{ flex: 1 }}
                />
              )}
              {notes.length > 0 ? (
                <MediaStageChip className="absolute top-1 right-1">
                  <View
                    className={cn(
                      "size-1.5 rounded-full",
                      noteStatusFillClassName(mostUrgentStatus(notes.map((note) => note.status))),
                    )}
                  />
                  <Text className="text-3xs font-t3-medium" style={{ color: MEDIA_STAGE.ink }}>
                    {notes.length}
                  </Text>
                </MediaStageChip>
              ) : null}
            </MediaStage>
            <View className="min-h-4 flex-row items-center gap-1 px-0.5">
              <Text className="font-mono text-3xs text-foreground-muted">
                {String(unit.index + 1).padStart(2, "0")}
              </Text>
              {working ? (
                <>
                  <SymbolView
                    name="circle.dashed"
                    size={11}
                    tintColorClassName="accent-adaptive-sky-600-400"
                    type="monochrome"
                    weight="semibold"
                  />
                  <Text numberOfLines={1} className="shrink text-3xs text-adaptive-sky-600-400">
                    Agent here
                  </Text>
                </>
              ) : (
                <Text numberOfLines={1} className="shrink text-3xs text-foreground">
                  {unit.title ?? ""}
                </Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** An image deliverable, or anything with one rendered frame: the frame, to mark an area on. */
export function WorkStillStage(props: {
  readonly rendition: DeliverableRendition;
  readonly highlight: DeliverableRegion | null;
  readonly marking: StageMarking;
  readonly assetUrl: AssetUrl;
}) {
  const { rendition } = props;
  const still = props.assetUrl(
    rendition.units[0]?.imageUrl ?? rendition.posterUrl ?? rendition.sourceUrl,
  );
  return (
    <WorkStage
      aspect={renditionAspect(rendition, 4 / 3)}
      noun="frame"
      highlight={props.highlight}
      marking={props.marking}
      controls={
        still === null ? null : (
          <View className="flex-row items-center justify-end px-4 pt-2 pb-1">
            <MarkAreaButton marking={props.marking} />
          </View>
        )
      }
    >
      {still === null ? (
        <MediaStageMessage>Nothing to show yet</MediaStageMessage>
      ) : (
        <Image
          source={{ uri: still }}
          contentFit="contain"
          style={{ flex: 1 }}
          accessibilityLabel="Image"
        />
      )}
    </WorkStage>
  );
}
