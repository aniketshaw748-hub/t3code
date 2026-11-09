import { createContext, use } from "react";

import { useAppearancePreferences } from "../../features/settings/appearance/AppearancePreferencesProvider";
import type {
  MobileThemeAppearance,
  MobileThemeId,
  MobileThemeVariables,
} from "../../lib/mobileTheme";

/** A subtree drawn in its own theme, such as Work mode's dark look; native controls follow it. */
export const ControlThemeOverrideContext = createContext<{
  readonly themeId: MobileThemeId;
  readonly colorScheme: MobileThemeAppearance;
  readonly colors: MobileThemeVariables;
} | null>(null);

export function useControlTheme() {
  const { themeId, themeAppearance, themeVariables, systemColorsActive, appearance } =
    useAppearancePreferences();
  const override = use(ControlThemeOverrideContext);
  if (override !== null) {
    return { ...override, systemColorsActive: false, fontSize: appearance.baseFontSize };
  }
  return {
    themeId,
    colorScheme: themeAppearance,
    colors: themeVariables,
    systemColorsActive,
    fontSize: appearance.baseFontSize,
  };
}
