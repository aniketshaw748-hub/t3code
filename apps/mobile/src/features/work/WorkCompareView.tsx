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
import { cn } from "../../lib/cn";
import { workEnvironment } from "../../state/work";
import { useRendition } from "./useWorkData";
import { renditionAspect } from "./WorkDeckStage";
import { WorkLink } from "./WorkLink";
import { MediaStage, MediaStageMessage, RegionOutline } from "./WorkMediaStage";

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
  /** Null when the earlier version can't be restored right now. */
  readonly onRestoreBase: (() => void) | null;
}) {
  const [which, setWhich] = useState<"changed" | "all">("changed");
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
  const aspect = renditionAspect(
    targetRendition ?? baseRendition ?? { width: null, height: null },
    16 / 9,
  );
  return (
    <View className="gap-4">
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
        <Text className="py-8 text-center text-sm text-foreground-muted">
          Nothing visible changed between these versions.
        </Text>
      ) : null}
      {shown.map((change) => (
        <View key={`${change.baseIndex}:${change.targetIndex}`} className="gap-2">
          <View className="flex-row items-center gap-2">
            <Text className="text-sm font-t3-medium">
              {compareUnitLabel(props.kind, change, targetRendition ?? baseRendition)}
            </Text>
            <Text
              className={cn(
                "text-xs font-t3-bold",
                change.status === "unchanged"
                  ? "text-foreground-muted"
                  : "text-adaptive-violet-600-400",
              )}
            >
              {UNIT_CHANGE_LABEL[change.status]}
            </Text>
          </View>
          <CompareFrame
            label={`V${props.base.ordinal}`}
            src={image(baseRendition, change.baseIndex)}
            aspect={aspect}
            region={null}
          />
          <CompareFrame
            label={`V${props.target.ordinal}`}
            src={image(targetRendition, change.targetIndex)}
            aspect={aspect}
            region={changeRegion(change)}
          />
        </View>
      ))}
      {props.onRestoreBase === null ? null : (
        <View className="flex-row flex-wrap items-center gap-x-1.5">
          <Text className="text-xs text-foreground-muted">Prefer the earlier one?</Text>
          <WorkLink label={`Restore V${props.base.ordinal}`} onPress={props.onRestoreBase} />
        </View>
      )}
    </View>
  );
}

function CompareFrame(props: {
  readonly label: string;
  readonly src: string | null;
  readonly aspect: number;
  readonly region: DeliverableRegion | null;
}) {
  return (
    <View className="gap-1">
      <MediaStage className="rounded-lg border border-border" style={{ aspectRatio: props.aspect }}>
        {props.src === null ? (
          <MediaStageMessage>Not in this version</MediaStageMessage>
        ) : (
          <Image
            source={{ uri: props.src }}
            contentFit="contain"
            style={{ flex: 1 }}
            accessibilityLabel={`${props.label} frame`}
          />
        )}
        {props.region === null ? null : <RegionOutline region={props.region} />}
      </MediaStage>
      <Text className="font-mono text-3xs text-foreground-muted">{props.label}</Text>
    </View>
  );
}
