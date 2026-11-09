import type { ReactNode } from "react";
import { Platform } from "react-native";
import { ScopedTheme, ScopedVariables } from "uniwind";

import { DEFAULT_MOBILE_THEME_ID } from "../../lib/mobileTheme";
import { getMobileThemeRuntimeVariables } from "../../lib/mobileThemeVariables";
import { getMobileUniwindThemeName } from "../../lib/mobileThemeRuntime";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

// The default dark theme is the Flask review look: near-black neutrals, white as the highlight.
const WORK_DARK_VARIABLES = getMobileThemeRuntimeVariables(
  DEFAULT_MOBILE_THEME_ID,
  "dark",
  Platform.OS,
);

/**
 * Work mode's own look, dark unless the user picked light for Work in Appearance settings.
 * Light keeps the user's own light theme.
 */
export function WorkTheme(props: { readonly children: ReactNode }) {
  const { workAppearance, themeIds, themeVariablesByAppearance } = useAppearancePreferences();
  const dark = workAppearance === "dark";
  return (
    <ScopedTheme
      theme={
        dark
          ? getMobileUniwindThemeName(DEFAULT_MOBILE_THEME_ID, "dark")
          : getMobileUniwindThemeName(themeIds.light, "light")
      }
    >
      <ScopedVariables variables={dark ? WORK_DARK_VARIABLES : themeVariablesByAppearance.light}>
        {props.children}
      </ScopedVariables>
    </ScopedTheme>
  );
}
