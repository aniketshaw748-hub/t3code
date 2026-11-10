import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { DeliverableRendition, DeliverableVersion, EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { useAtomCommand } from "../../state/use-atom-command";
import { workEnvironment } from "../../state/work";

/** A version's render ended without a preview: why, in plain words, and a way to render again. */
export function WorkRenderFailure(props: {
  readonly environmentId: EnvironmentId;
  readonly version: DeliverableVersion;
  readonly rendition: DeliverableRendition;
  readonly canOperate: boolean;
}) {
  const retryRendition = useAtomCommand(workEnvironment.retryRendition, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const retry = async () => {
    setPending(true);
    const result = await retryRendition({
      environmentId: props.environmentId,
      input: { versionId: props.version.id },
    });
    setPending(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      Dialog.alert("Could not render it again", error instanceof Error ? error.message : undefined);
    }
  };
  return (
    <View
      accessibilityRole="alert"
      className="mx-4 gap-2.5 rounded-2xl border border-border bg-subtle p-3"
    >
      <View className="flex-row items-start gap-2">
        <SymbolView name="exclamationmark.circle" size={16} tintColorClassName="accent-icon" />
        <Text className="shrink text-sm">
          <Text className="text-sm font-t3-medium">
            V{props.version.ordinal} could not be rendered.
          </Text>
          {props.rendition.detail ? ` ${props.rendition.detail}` : ""}
        </Text>
      </View>
      {props.canOperate ? (
        <Pressable
          accessibilityRole="button"
          disabled={pending}
          onPress={() => void retry()}
          className="h-8 flex-row items-center gap-1.5 self-start rounded-full bg-foreground px-3"
        >
          <SymbolView name="arrow.clockwise" size={12} tintColorClassName="accent-screen" />
          <Text className="text-xs font-t3-medium text-screen">Render again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
