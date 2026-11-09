import type { ShelfStatusKind } from "@t3tools/client-runtime/work/shelf";
import type { DeliverableNoteStatus } from "@t3tools/contracts";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

// Work mode's note statuses, the same four colours the desktop uses for its markers and tags.
const NOTE_STATUS_COLORS = {
  light: { open: "#d97706", fixing: "#0284c7", fixed: "#7c3aed", resolved: "#059669" },
  dark: { open: "#f5b94d", fixing: "#7cc4f8", fixed: "#c4a5ff", resolved: "#6fd8a6" },
} as const satisfies Record<"light" | "dark", Record<DeliverableNoteStatus, string>>;

export function useNoteStatusColors(): Readonly<Record<DeliverableNoteStatus, string>> {
  return NOTE_STATUS_COLORS[useAppearancePreferences().themeAppearance];
}

const SHELF_STATUS: Record<ShelfStatusKind, DeliverableNoteStatus | null> = {
  waiting: "open",
  rendering: "fixing",
  drafting: "fixing",
  failed: "open",
  "notes-back": "fixed",
  "in-review": "fixed",
  final: "resolved",
  ready: null,
  empty: null,
};

export function StatusDot(props: { readonly color: string; readonly size?: number }) {
  const size = props.size ?? 6;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: props.color }}
    />
  );
}

/** A note's status: a coloured dot and its plain label in a neutral pill. */
export function NoteStatusTag(props: {
  readonly status: DeliverableNoteStatus;
  readonly label: string;
}) {
  const colors = useNoteStatusColors();
  return (
    <View className="h-6 flex-row items-center gap-1.5 rounded-full bg-subtle px-2.5">
      <StatusDot color={colors[props.status]} />
      <Text className="text-2xs font-t3-medium">{props.label}</Text>
    </View>
  );
}

/** The one plain status a project card shows. */
export function ShelfStatusChip(props: { readonly kind: ShelfStatusKind; readonly label: string }) {
  const colors = useNoteStatusColors();
  const status = SHELF_STATUS[props.kind];
  return (
    <View className="h-6 max-w-full flex-row items-center gap-1.5 self-start rounded-full border border-border bg-card px-2.5">
      {status === null ? null : <StatusDot color={colors[status]} />}
      <Text numberOfLines={1} className="shrink text-2xs">
        {props.label}
      </Text>
    </View>
  );
}
