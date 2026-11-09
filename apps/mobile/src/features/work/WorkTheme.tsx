import { useMemo, type ReactNode } from "react";
import { Platform } from "react-native";
import { ScopedTheme, ScopedVariables } from "uniwind";

import { ControlThemeOverrideContext } from "../../components/ui/useControlTheme";
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

/** The colors Work mode draws with, for native surfaces that class names do not reach. */
export function useWorkThemeVariables() {
  const { workAppearance, themeVariablesByAppearance } = useAppearancePreferences();
  return workAppearance === "dark" ? WORK_DARK_VARIABLES : themeVariablesByAppearance.light;
}

/**
 * Work mode's own look, dark unless the user picked light for Work in Appearance settings.
 * Light keeps the user's own light theme.
 */
export function WorkTheme(props: { readonly children: ReactNode }) {
  const { workAppearance, themeIds } = useAppearancePreferences();
  const dark = workAppearance === "dark";
  const colors = useWorkThemeVariables();
  const control = useMemo(
    () => ({
      themeId: dark ? DEFAULT_MOBILE_THEME_ID : themeIds.light,
      colorScheme: workAppearance,
      colors,
    }),
    [colors, dark, themeIds.light, workAppearance],
  );
  return (
    <ControlThemeOverrideContext value={control}>
      <ScopedTheme
        theme={
          dark
            ? getMobileUniwindThemeName(DEFAULT_MOBILE_THEME_ID, "dark")
            : getMobileUniwindThemeName(themeIds.light, "light")
        }
      >
        <ScopedVariables variables={colors}>{props.children}</ScopedVariables>
      </ScopedTheme>
    </ControlThemeOverrideContext>
  );
}
