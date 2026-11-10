import type { DeliverableComparison } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { WorkLink } from "./WorkLink";

/**
 * Why two versions show no comparison, in the server's own words: one is still rendering, one
 * could not be rendered, one's file is gone, or the comparison itself failed. Waiting and
 * failing each get their own icon, and a failure that asking again can cure offers to.
 */
export function WorkComparisonNotice(props: {
  readonly result: AsyncResult.AsyncResult<DeliverableComparison, unknown>;
  readonly onRetry: () => void;
}) {
  const unavailable = AsyncResult.getOrElse(props.result, () => null)?.unavailable ?? null;
  const failed = AsyncResult.isFailure(props.result);
  if (unavailable === null && !failed) return null;
  const retryable = unavailable?.reason === "comparison_failed" || (unavailable === null && failed);
  return (
    <View className="gap-1">
      <View className="flex-row items-start gap-1.5">
        {/* As tall as one line of the words, so the icon sits on the first line. */}
        <View className="h-[19px] justify-center">
          <SymbolView
            name={unavailable?.reason === "rendering" ? "clock" : "exclamationmark.circle"}
            size={14}
            tintColorClassName="accent-icon-muted"
            type="monochrome"
          />
        </View>
        <Text className="shrink text-sm text-foreground-muted">
          {unavailable?.message ?? "The comparison could not be loaded from the server."}
        </Text>
      </View>
      {retryable ? (
        <View className="pl-5">
          <WorkLink label="Try again" onPress={props.onRetry} />
        </View>
      ) : null}
    </View>
  );
}
