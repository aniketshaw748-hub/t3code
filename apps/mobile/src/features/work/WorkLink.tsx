import { Pressable } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

/** A link in a line of text: the app's link colour, with a touch target taller than its words. */
export function WorkLink(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      accessibilityHint={props.accessibilityHint}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={10}
      className="self-start active:opacity-70"
    >
      <Text
        className={cn(
          "text-xs font-t3-medium",
          props.disabled ? "text-foreground-muted" : "text-primary-text",
        )}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
