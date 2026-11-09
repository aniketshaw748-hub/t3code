import type {
  HistoryAction,
  HistoryAvailability,
  VersionStripItem,
} from "@t3tools/client-runtime/work/versions";
import type { DeliverableVersionId } from "@t3tools/contracts";
import { Pressable, ScrollView, View } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

/**
 * V1..Vn as chips with undo, redo and compare. Undo and redo say why they are off, since a
 * phone has no tooltip: the reason sits under the strip while it applies.
 */
export function WorkVersionStrip(props: {
  readonly items: ReadonlyArray<VersionStripItem>;
  readonly history: HistoryAvailability;
  readonly viewedVersionId: DeliverableVersionId | null;
  readonly compared: ReadonlySet<DeliverableVersionId> | null;
  readonly onView: (versionId: DeliverableVersionId) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onToggleCompare: () => void;
}) {
  // Running, pending or read-only; "first version" and "nothing to redo" show as a dim button.
  const reason = props.history.restoreBlockedReason;
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
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
          className="flex-1"
          contentContainerClassName="gap-1.5 pr-2"
        >
          {props.items.map((item) => {
            const compared = props.compared?.has(item.version.id) ?? false;
            const viewed = props.compared === null && item.version.id === props.viewedVersionId;
            return (
              <Pressable
                key={item.version.id}
                accessibilityRole="button"
                accessibilityState={{ selected: compared || viewed }}
                accessibilityLabel={`Version ${item.version.ordinal}${item.isCurrent ? ", current" : ""}${item.alternate ? ", alternate" : ""}${item.forkedFromOrdinal === null ? "" : `, made from V${item.forkedFromOrdinal}`}`}
                onPress={() => props.onView(item.version.id)}
                className={cn(
                  "h-8 flex-row items-center gap-1 rounded-full px-3 active:opacity-70",
                  item.isCurrent ? "bg-foreground" : "bg-subtle",
                  (compared || viewed) && !item.isCurrent && "border border-foreground",
                  item.alternate && "opacity-60",
                )}
              >
                <Text
                  className={cn(
                    "font-mono text-2xs font-t3-medium",
                    item.isCurrent ? "text-screen" : "text-foreground",
                  )}
                >
                  V{item.version.ordinal}
                </Text>
                {item.forkedFromOrdinal === null ? null : (
                  <Text
                    className={cn(
                      "font-mono text-3xs",
                      item.isCurrent ? "text-screen" : "text-foreground-muted",
                    )}
                  >
                    ←V{item.forkedFromOrdinal}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.compared === null ? "Compare versions" : "Stop comparing"}
          accessibilityState={{ selected: props.compared !== null }}
          disabled={props.items.length < 2}
          onPress={props.onToggleCompare}
          className={cn(
            "h-8 flex-row items-center gap-1.5 rounded-full px-3 active:opacity-70",
            props.compared === null ? "bg-subtle" : "bg-foreground",
            props.items.length < 2 && "opacity-40",
          )}
        >
          <SymbolView
            name="square.split.2x1"
            size={15}
            tintColorClassName={props.compared === null ? "accent-icon" : "accent-screen"}
          />
          <Text
            className={cn(
              "text-2xs font-t3-medium",
              props.compared === null ? "text-foreground" : "text-screen",
            )}
          >
            {props.compared === null ? "Compare" : "Done"}
          </Text>
        </Pressable>
      </View>
      {reason === null ? null : <Text className="text-2xs text-foreground-muted">{reason}</Text>}
      {props.compared === null ? null : (
        <Text className="text-2xs text-foreground-muted">Tap a version to compare it.</Text>
      )}
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
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityHint={props.action.reason ?? undefined}
      accessibilityState={{ disabled: !props.action.enabled }}
      disabled={!props.action.enabled}
      onPress={props.onPress}
      hitSlop={6}
      className={cn(
        "size-8 items-center justify-center rounded-full bg-subtle",
        props.action.enabled ? "active:opacity-70" : "opacity-40",
      )}
    >
      <SymbolView name={props.icon} size={16} tintColorClassName="accent-icon" />
    </Pressable>
  );
}
