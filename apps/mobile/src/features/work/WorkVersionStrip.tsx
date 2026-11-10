import type {
  HistoryAction,
  HistoryAvailability,
  VersionStripItem,
} from "@t3tools/client-runtime/work/versions";
import type { DeliverableVersionId } from "@t3tools/contracts";
import { ScrollView, View } from "react-native";

import type { AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Chip } from "../../components/ui/Chip";
import { IconButton } from "../../components/ui/IconButton";

const versionLabel = (item: VersionStripItem) =>
  [
    `V${item.version.ordinal}`,
    item.isCurrent ? "now" : null,
    item.forkedFromOrdinal === null ? null : `from V${item.forkedFromOrdinal}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");

/**
 * V1..Vn as chips with undo, redo and compare. Undo and redo say why they are off, since a
 * phone has no tooltip: the reason sits under the strip while it applies.
 */
export function WorkVersionStrip(props: {
  readonly items: ReadonlyArray<VersionStripItem>;
  readonly history: HistoryAvailability;
  readonly viewedVersionId: DeliverableVersionId | null;
  /** In compare mode, the two picked versions. */
  readonly compared: ReadonlySet<DeliverableVersionId> | null;
  readonly onView: (versionId: DeliverableVersionId) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onToggleCompare: () => void;
}) {
  const comparing = props.compared !== null;
  // Running, pending or read-only; "first version" and "nothing to redo" show as a dim button.
  const reason = props.history.restoreBlockedReason;
  return (
    <View className="gap-1">
      <View className="flex-row items-center">
        <HistoryButton
          label="Undo"
          icon="arrow.uturn.backward"
          action={props.history.undo}
          onPress={props.onUndo}
        />
        <HistoryButton
          label="Redo"
          icon="arrow.uturn.forward"
          action={props.history.redo}
          onPress={props.onRedo}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityLabel={comparing ? "Pick two versions to compare" : "Versions"}
          className="flex-1"
          contentContainerClassName="items-center gap-1.5 px-1"
        >
          {props.items.map((item) => {
            const id = item.version.id;
            const picked = props.compared?.has(id) ?? false;
            const viewed = !comparing && id === props.viewedVersionId;
            return (
              <View key={id} className={item.alternate ? "opacity-60" : undefined}>
                <Chip
                  label={versionLabel(item)}
                  selected={picked || viewed}
                  accessibilityLabel={`Version ${item.version.ordinal}${item.isCurrent ? ", current" : ""}${item.alternate ? ", alternate branch" : ""}${item.forkedFromOrdinal === null ? "" : `, made from V${item.forkedFromOrdinal}`}${item.version.summary ? `: ${item.version.summary}` : ""}`}
                  onPress={() => props.onView(id)}
                />
              </View>
            );
          })}
        </ScrollView>
        <Chip
          icon="square.split.2x1"
          label={comparing ? "Done" : "Compare"}
          selected={comparing}
          accessibilityLabel={comparing ? "Stop comparing" : "Compare versions"}
          disabled={props.items.length < 2}
          onPress={props.onToggleCompare}
        />
      </View>
      {reason === null ? null : <Text className="text-xs text-foreground-muted">{reason}</Text>}
      {comparing ? (
        <Text className="text-xs text-foreground-muted">Tap a version to compare it.</Text>
      ) : null}
    </View>
  );
}

function HistoryButton(props: {
  readonly label: string;
  readonly icon: AppSymbolName;
  readonly action: HistoryAction;
  readonly onPress: () => void;
}) {
  return (
    <IconButton
      icon={props.icon}
      accessibilityLabel={
        props.action.reason === null ? props.label : `${props.label}: ${props.action.reason}`
      }
      disabled={!props.action.enabled}
      onPress={props.onPress}
    />
  );
}
