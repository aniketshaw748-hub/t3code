import type { ReactNode } from "react";
import { View } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

const TONE = {
  info: {
    box: "border-border bg-card",
    text: "text-foreground",
    detail: "text-foreground-muted",
    tint: "accent-icon-muted",
  },
  warning: {
    box: "border-warning-border bg-warning",
    text: "text-warning-foreground",
    detail: "text-warning-foreground",
    tint: "accent-warning-foreground",
  },
  danger: {
    box: "border-danger-border bg-danger",
    text: "text-danger-foreground",
    detail: "text-danger-foreground",
    tint: "accent-danger-foreground",
  },
} as const;

/**
 * Something about the project that needs saying above the notes: an icon and a heading in
 * words, one sentence of detail, and what can be done about it. The whole box takes the tone.
 */
export function WorkBanner(props: {
  readonly tone: keyof typeof TONE;
  readonly icon: AppSymbolName;
  readonly title: string;
  readonly detail?: string | null;
  /** Announces itself to a screen reader when it appears. */
  readonly alert?: boolean;
  readonly children?: ReactNode;
}) {
  const tone = TONE[props.tone];
  return (
    <View
      accessibilityRole={props.alert ? "alert" : undefined}
      className={cn("gap-2 rounded-2xl border px-3.5 py-3", tone.box)}
    >
      <View className="flex-row items-start gap-2.5">
        <View className="pt-0.5">
          <SymbolView
            name={props.icon}
            size={16}
            tintColorClassName={tone.tint}
            type="monochrome"
          />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className={cn("text-sm font-t3-medium", tone.text)}>{props.title}</Text>
          {props.detail ? <Text className={cn("text-sm", tone.detail)}>{props.detail}</Text> : null}
        </View>
      </View>
      {props.children === undefined || props.children === null ? null : (
        <View className="flex-row flex-wrap items-center justify-end gap-1">{props.children}</View>
      )}
    </View>
  );
}
