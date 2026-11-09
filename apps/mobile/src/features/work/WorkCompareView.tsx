import { useAtomValue } from "@effect/atom-react";
import {
  changeRegion,
  compareUnitLabel,
  UNIT_CHANGE_LABEL,
} from "@t3tools/client-runtime/work/anchors";
import type {
  DeliverableKind,
  DeliverableRegion,
  DeliverableRendition,
  DeliverableVersion,
  EnvironmentId,
} from "@t3tools/contracts";
import { Image } from "expo-image";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { workEnvironment } from "../../state/work";
import { useRendition } from "./useWorkData";
import { useNoteStatusColors } from "./WorkStatus";

/**
 * Two versions, one above the other on a phone, for every slide or shot the comparison
 * found; changed ones are marked and their changed area outlined on the newer frame.
 */
export function WorkCompareView(props: {
  readonly environmentId: EnvironmentId;
  readonly kind: DeliverableKind;
  readonly base: DeliverableVersion;
  readonly target: DeliverableVersion;
  readonly assetUrl: (url: string | null | undefined) => string | null;
}) {
  const [which, setWhich] = useState<"changed" | "all">("changed");
  const colors = useNoteStatusColors();
  const comparison = useAtomValue(
    workEnvironment.compare({
      environmentId: props.environmentId,
      input: { baseVersionId: props.base.id, targetVersionId: props.target.id },
    }),
  );
  const baseRendition = useRendition(
    props.environmentId,
    props.base.id,
    props.base.renditionStatus,
  );
  const targetRendition = useRendition(
    props.environmentId,
    props.target.id,
    props.target.renditionStatus,
  );
  const value = AsyncResult.getOrElse(comparison, () => null);
  const changes = value?.units ?? [];
  const shown = which === "all" ? changes : changes.filter((unit) => unit.status !== "unchanged");
  const image = (rendition: DeliverableRendition | null, index: number | null) => {
    if (index === null || rendition === null) return null;
    const unit = rendition.units.find((candidate) => candidate.index === index);
    return props.assetUrl(unit?.imageUrl ?? unit?.thumbUrl ?? rendition.posterUrl);
  };
  const aspect =
    targetRendition?.width && targetRendition.height
      ? targetRendition.width / targetRendition.height
      : 16 / 9;
  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text className="text-base font-t3-medium">
          V{props.base.ordinal} → V{props.target.ordinal}
          {value === null ? "" : ` · ${value.headline}`}
        </Text>
        {value?.summary ? (
          <Text className="text-sm text-foreground-muted">{value.summary}</Text>
        ) : null}
        {AsyncResult.isFailure(comparison) ? (
          <Text className="text-sm text-foreground-muted">
            These versions can't be compared until both finish rendering.
          </Text>
        ) : null}
      </View>
      <SegmentedControl
        size="compact"
        options={[
          { value: "changed", label: "Changed" },
          { value: "all", label: "All" },
        ]}
        selected={which}
        onSelect={setWhich}
      />
      {value !== null && shown.length === 0 ? (
        <View className="rounded-xl border border-dashed border-border px-4 py-8">
          <Text className="text-center text-sm text-foreground-muted">
            Nothing visible changed between these versions.
          </Text>
        </View>
      ) : null}
      {shown.map((change) => {
        const region = changeRegion(change);
        return (
          <View key={`${change.baseIndex}:${change.targetIndex}`} className="gap-2">
            <View className="flex-row items-center gap-2">
              <Text className="text-sm font-t3-medium">
                {compareUnitLabel(props.kind, change, targetRendition ?? baseRendition)}
              </Text>
              <View
                className="rounded-full px-2 py-0.5"
                style={{
                  backgroundColor:
                    change.status === "unchanged" ? "transparent" : `${colors.fixed}26`,
                }}
              >
                <Text
                  className="text-2xs font-t3-medium"
                  style={change.status === "unchanged" ? undefined : { color: colors.fixed }}
                >
                  {UNIT_CHANGE_LABEL[change.status]}
                </Text>
              </View>
            </View>
            <CompareFrame
              label={`V${props.base.ordinal}`}
              src={image(baseRendition, change.baseIndex)}
              aspect={aspect}
              region={null}
              regionColor={colors.fixed}
            />
            <CompareFrame
              label={`V${props.target.ordinal}`}
              src={image(targetRendition, change.targetIndex)}
              aspect={aspect}
              region={region}
              regionColor={colors.fixed}
            />
          </View>
        );
      })}
    </View>
  );
}

function CompareFrame(props: {
  readonly label: string;
  readonly src: string | null;
  readonly aspect: number;
  readonly region: DeliverableRegion | null;
  readonly regionColor: string;
}) {
  return (
    <View className="gap-1">
      <View
        className="overflow-hidden rounded-lg border border-border"
        style={{ aspectRatio: props.aspect, backgroundColor: "#0b0b0b" }}
      >
        {props.src === null ? (
          <View className="flex-1 items-center justify-center">
            <Text className="text-xs" style={{ color: "#8a8a8a" }}>
              Not in this version
            </Text>
          </View>
        ) : (
          <Image
            source={{ uri: props.src }}
            contentFit="contain"
            style={{ flex: 1 }}
            accessibilityLabel={`${props.label} frame`}
          />
        )}
        {props.region === null ? null : (
          <View
            pointerEvents="none"
            className="absolute rounded-sm border-2"
            style={{
              left: `${props.region.x * 100}%`,
              top: `${props.region.y * 100}%`,
              width: `${props.region.w * 100}%`,
              height: `${props.region.h * 100}%`,
              borderColor: props.regionColor,
            }}
          />
        )}
      </View>
      <Text className="font-mono text-3xs text-foreground-muted">{props.label}</Text>
    </View>
  );
}
