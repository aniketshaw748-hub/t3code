import { useEffect } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { setAppearanceOverride } from "~/hooks/useTheme";

/** Work mode's dark review look, shown over the user's theme unless they chose light for Work. */
export function useWorkAppearance() {
  const appearance = useClientSettings((settings) => settings.workAppearance);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the theme engine lives outside React; Work mode hands its look back when it unmounts
  useEffect(() => {
    setAppearanceOverride(appearance);
    return () => setAppearanceOverride(null);
  }, [appearance]);
}
