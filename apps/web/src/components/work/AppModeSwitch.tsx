import type { AppMode } from "@t3tools/contracts";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ArrowLeftRightIcon } from "lucide-react";

import { updateClientSettings } from "../../hooks/useSettings";
import { ITEM_ICON_CLASS, type CommandPaletteActionItem } from "../CommandPalette.logic";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { isWorkPath } from "./workPaths";

const MODES: ReadonlyArray<{ readonly id: AppMode; readonly label: string }> = [
  { id: "code", label: "Code" },
  { id: "work", label: "Work" },
];

/** The mode the app shell is in, and a way to move to the other; the choice is remembered. */
function useAppMode() {
  const navigate = useNavigate();
  const mode: AppMode = useLocation({
    select: (location) => (isWorkPath(location.pathname) ? "work" : "code"),
  });
  const setMode = (next: AppMode) => {
    if (next === mode) return;
    void updateClientSettings({ appMode: next });
    void navigate({ to: next === "work" ? "/work" : "/" });
  };
  return { mode, setMode };
}

/** The command palette's way to change mode, for when the sidebar and its switch are hidden. */
export function useAppModeCommandItem(): CommandPaletteActionItem {
  const { mode, setMode } = useAppMode();
  const other = MODES.find((candidate) => candidate.id !== mode) ?? MODES[0]!;
  return {
    kind: "action",
    value: "action:switch-app-mode",
    searchTerms: ["mode", "switch", "code", "work", "threads", "deck", "video", "shelf"],
    title: `Switch to ${other.label}`,
    description:
      other.id === "work" ? "Decks, videos and images, reviewed with notes" : "Threads and code",
    icon: <ArrowLeftRightIcon className={ITEM_ICON_CLASS} />,
    run: async () => setMode(other.id),
  };
}

/**
 * Code or Work, the two top-level modes of the app shell: two quiet tabs under the sidebar
 * header, the weight of the sidebar's own rows. Arrow keys move between them.
 */
export function AppModeSwitch() {
  const { mode, setMode } = useAppMode();
  return (
    // Above the stage artwork, which runs on below the header behind this row.
    <div className="relative z-10 flex shrink-0 px-2 pb-1">
      <ToggleGroup
        aria-label="Mode"
        variant="default"
        value={[mode]}
        onValueChange={(next) => {
          const chosen = MODES.find((candidate) => candidate.id === next[0]);
          if (chosen !== undefined) setMode(chosen.id);
        }}
      >
        {MODES.map((candidate) => (
          <Toggle key={candidate.id} value={candidate.id} variant="ghost" size="segmented">
            {candidate.label}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  );
}
