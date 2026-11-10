import type { ReactNode } from "react";
import { View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

/** Who wrote something in Work: a person by their initial, the agent by its mark. */
export type WorkAuthor =
  | { readonly kind: "person"; readonly name: string }
  | { readonly kind: "agent" };

export const AGENT_AUTHOR: WorkAuthor = { kind: "agent" };
export const YOU_AUTHOR: WorkAuthor = { kind: "person", name: "You" };

const authorName = (author: WorkAuthor) => (author.kind === "agent" ? "Agent" : author.name);

function AuthorAvatar(props: { readonly author: WorkAuthor }) {
  const { author } = props;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn(
        "size-6 items-center justify-center rounded-full border border-border",
        author.kind === "agent" ? "bg-subtle-strong" : "bg-subtle",
      )}
    >
      {author.kind === "agent" ? (
        <SymbolView name="sparkles" size={12} tintColorClassName="accent-icon" type="monochrome" />
      ) : (
        <Text className="text-3xs font-t3-bold text-foreground-muted">
          {author.name.slice(0, 1).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

/** The avatar and name that say who wrote the thing below, with room for a time and a chip. */
export function AuthorLine(props: {
  readonly author: WorkAuthor;
  /** Shown muted after the name, such as when it was written. */
  readonly meta?: ReactNode;
  /** Sits at the end of the line, such as where a note points. */
  readonly trailing?: ReactNode;
}) {
  return (
    <View className="min-w-0 flex-row items-center gap-2">
      <AuthorAvatar author={props.author} />
      <Text numberOfLines={1} className="shrink text-xs font-t3-medium">
        {authorName(props.author)}
      </Text>
      {props.meta === undefined ? null : (
        <Text className="text-2xs text-foreground-muted">{props.meta}</Text>
      )}
      <View className="flex-1" />
      {props.trailing}
    </View>
  );
}
