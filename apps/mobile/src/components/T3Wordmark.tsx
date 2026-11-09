import { BRAND } from "@t3tools/contracts/brand";
import type { ColorValue } from "react-native";
import Svg, { Text as SvgText } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedText = withUniwind(SvgText);

/** The brand's monogram: the first letter of its name, drawn at the given cap height. */
export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    <Svg
      accessibilityLabel={BRAND.displayName}
      height={props.height}
      width={props.height}
      viewBox="0 0 10 10"
    >
      <ThemedText
        x={5}
        y={10}
        fontFamily="DMSans-Bold"
        fontSize={14}
        textAnchor="middle"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      >
        {BRAND.displayName.charAt(0).toUpperCase()}
      </ThemedText>
    </Svg>
  );
}
