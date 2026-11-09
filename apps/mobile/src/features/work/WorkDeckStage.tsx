import { mostUrgentStatus } from "@t3tools/client-runtime/work/notes";
import type { DeliverableNote, DeliverableRendition } from "@t3tools/contracts";
import { Image } from "expo-image";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { StatusDot, useNoteStatusColors } from "./WorkStatus";

const STAGE_BG = "#0b0b0b";

/**
 * A deck or PDF: the picked slide large, with previous and next, over a grid of every slide.
 * A slide with notes carries a dot coloured by its most urgent one.
 */
export function WorkDeckStage(props: {
  readonly rendition: DeliverableRendition;
  readonly notes: ReadonlyArray<DeliverableNote>;
  readonly noun: "Slide" | "Page";
  readonly selectedSlide: number | null;
  readonly workingSlide: number | null;
  readonly assetUrl: (url: string | null | undefined) => string | null;
  readonly onSelectSlide: (index: number | null) => void;
}) {
  const colors = useNoteStatusColors();
  const units = props.rendition.units;
  const aspect =
    props.rendition.width !== null && props.rendition.height !== null && props.rendition.height > 0
      ? props.rendition.width / props.rendition.height
      : 16 / 9;
  const selected = units.find((unit) => unit.index === props.selectedSlide) ?? null;
  const position = selected === null ? -1 : units.indexOf(selected);
  const statusOf = (index: number) => {
    const statuses = props.notes.flatMap((note) =>
      note.anchor?.kind === "slide" && note.anchor.index === index ? [note.status] : [],
    );
    return statuses.length === 0 ? null : mostUrgentStatus(statuses);
  };
  return (
    <View className="gap-3">
      {selected === null ? null : (
        <View className="gap-2">
          <View
            className="overflow-hidden rounded-xl"
            style={{ aspectRatio: aspect, backgroundColor: STAGE_BG }}
          >
            <Image
              source={{ uri: props.assetUrl(selected.imageUrl ?? selected.thumbUrl) ?? undefined }}
              contentFit="contain"
              style={{ flex: 1 }}
              accessibilityLabel={`${props.noun} ${selected.index + 1}${selected.title ? `: ${selected.title}` : ""}`}
            />
          </View>
          <View className="flex-row items-center gap-2">
            <StepButton
              label={`Previous ${props.noun.toLowerCase()}`}
              icon="chevron.left"
              disabled={position <= 0}
              onPress={() => props.onSelectSlide(units[position - 1]?.index ?? null)}
            />
            <Text className="flex-1 text-center text-sm font-t3-medium">
              {props.noun} {selected.index + 1} of {units.length}
            </Text>
            <StepButton
              label={`Next ${props.noun.toLowerCase()}`}
              icon="chevron.right"
              disabled={position < 0 || position >= units.length - 1}
              onPress={() => props.onSelectSlide(units[position + 1]?.index ?? null)}
            />
          </View>
        </View>
      )}
      <View className="flex-row flex-wrap gap-2">
        {units.map((unit) => {
          const status = statusOf(unit.index);
          const isSelected = unit.index === props.selectedSlide;
          return (
            <Pressable
              key={unit.index}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${props.noun} ${unit.index + 1}${status === null ? "" : ", has notes"}`}
              onPress={() => props.onSelectSlide(isSelected ? null : unit.index)}
              className="basis-[31%] grow-0 gap-1 active:opacity-80"
            >
              <View
                className={
                  isSelected
                    ? "overflow-hidden rounded-lg border-2 border-foreground"
                    : "overflow-hidden rounded-lg border border-border"
                }
                style={{ aspectRatio: aspect, backgroundColor: STAGE_BG }}
              >
                <Image
                  source={{ uri: props.assetUrl(unit.thumbUrl ?? unit.imageUrl) ?? undefined }}
                  contentFit="cover"
                  recyclingKey={`${props.rendition.versionId}:${unit.index}`}
                  style={{ flex: 1 }}
                />
              </View>
              <View className="flex-row items-center gap-1">
                <Text className="font-mono text-3xs text-foreground-muted">{unit.index + 1}</Text>
                {status === null ? null : <StatusDot color={colors[status]} />}
                {props.workingSlide === unit.index ? (
                  <Text className="text-3xs text-foreground-muted">· agent here</Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function StepButton(props: {
  readonly label: string;
  readonly icon: "chevron.left" | "chevron.right";
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={8}
      className={
        props.disabled
          ? "size-10 items-center justify-center rounded-full bg-subtle opacity-40"
          : "size-10 items-center justify-center rounded-full bg-subtle active:opacity-70"
      }
    >
      <SymbolView name={props.icon} size={18} tintColorClassName="accent-icon" />
    </Pressable>
  );
}
