import type { AppMode } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";

import { updateClientSettings } from "../../hooks/useSettings";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { isWorkPath } from "./workPaths";

/** Code or Work: the two top-level modes of the app shell, remembered across launches. */
export function AppModeSwitch() {
  const navigate = useNavigate();
  const mode: AppMode = useLocation({
    select: (location) => (isWorkPath(location.pathname) ? "work" : "code"),
  });
  const choose = (next: AppMode) => {
    if (next === mode) return;
    void updateClientSettings({ appMode: next });
    void navigate({ to: next === "work" ? "/work" : "/" });
  };
  return (
    <ToggleGroup
      aria-label="Mode"
      variant="segmented"
      className="relative z-10 w-full"
      value={[mode]}
      onValueChange={(next) => {
        const value = next[0];
        if (value === "code" || value === "work") choose(value);
      }}
    >
      <Toggle value="code" className="flex-1">
        Code
      </Toggle>
      <Toggle value="work" className="flex-1">
        Work
      </Toggle>
    </ToggleGroup>
  );
}
