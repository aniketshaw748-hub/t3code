import type { DesktopT3ImportPreview } from "@t3tools/contracts";
import { useState } from "react";

import { updateClientSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const LOCAL_STORAGE_LABELS: Record<string, string> = {
  "t3code:theme": "Theme",
  "t3code:themes:v1": "Custom themes",
  "t3code:theme-follow-system": "Follow system appearance",
  "t3code:theme-appearance-mode": "Light or dark appearance",
  "t3code:theme-halves:v1": "Light and dark theme pair",
  "t3code:typography-advanced": "Advanced typography",
  chat_thread_sidebar_width: "Sidebar width",
  "t3code:preview-panel-width": "Preview panel width",
  "t3code:last-editor": "Preferred editor",
  "t3code:sidebar:settled-expanded": "Settled section open",
  "t3code:sidebar:snoozed-expanded": "Snoozed section open",
  "t3code:sidebar:working-expanded": "Working section open",
};

const humanize = (key: string) => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const zoomPercent = (level: number) => `${Math.round(1.2 ** level * 100)}%`;

const readLocalStorage = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

type Group = "settings" | "layout" | "zoom" | "keybindings" | "themes";

function ImportGroup(props: {
  readonly title: string;
  readonly items: ReadonlyArray<string>;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  if (props.items.length === 0) return null;
  return (
    <label className="flex gap-3 py-2">
      <Checkbox
        checked={props.checked}
        onCheckedChange={(checked) => props.onCheckedChange(checked === true)}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{props.title}</span>
        <span className="block text-xs text-muted-foreground">{props.items.join(", ")}</span>
      </span>
    </label>
  );
}

function T3ImportDialog(props: {
  readonly preview: DesktopT3ImportPreview;
  readonly onClose: () => void;
}) {
  const { preview } = props;
  const layout = Object.entries(preview.localStorage).filter(
    ([key, value]) => readLocalStorage(key) !== value,
  );
  const settingKeys = Object.keys(preview.clientSettings);
  const [selected, setSelected] = useState<Record<Group, boolean>>({
    settings: true,
    layout: true,
    zoom: true,
    keybindings: true,
    themes: true,
  });
  const [importing, setImporting] = useState(false);
  const toggle = (group: Group) => (checked: boolean) =>
    setSelected((current) => ({ ...current, [group]: checked }));

  const nothing =
    settingKeys.length === 0 &&
    layout.length === 0 &&
    preview.zoomLevel === null &&
    preview.keybindingCommands.length === 0 &&
    preview.themeFiles.length === 0;
  const anySelected =
    (selected.settings && settingKeys.length > 0) ||
    (selected.layout && layout.length > 0) ||
    (selected.zoom && preview.zoomLevel !== null) ||
    (selected.keybindings && preview.keybindingCommands.length > 0) ||
    (selected.themes && preview.themeFiles.length > 0);

  const run = async () => {
    const bridge = window.desktopBridge?.t3Import;
    if (!bridge) return;
    setImporting(true);
    try {
      await bridge.apply({
        keybindings: selected.keybindings,
        themes: selected.themes,
        zoom: selected.zoom && preview.zoomLevel !== null,
      });
      if (selected.settings && settingKeys.length > 0) {
        await updateClientSettings(preview.clientSettings);
      }
      if (selected.layout && layout.length > 0) {
        for (const [key, value] of layout) window.localStorage.setItem(key, value);
        // Theme, sidebar width and the rest are read once at startup.
        window.location.reload();
        return;
      }
      toastManager.add(stackedThreadToast({ type: "success", title: "Imported from T3 Code" }));
      props.onClose();
    } catch (error) {
      setImporting(false);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not import from T3 Code",
          description: error instanceof Error ? error.message : "Something went wrong.",
        }),
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !importing && props.onClose()}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from T3 Code</DialogTitle>
          <DialogDescription>
            {preview.sourceDir === null
              ? "T3 Code's data was not found for this user."
              : `Reads ${preview.sourceDir} without changing it. Threads, accounts, credentials and databases are never copied.`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {preview.sourceDir !== null && nothing ? (
            <p className="text-sm text-muted-foreground">
              Nothing to import: these already match T3 Code.
            </p>
          ) : null}
          <ImportGroup
            title={`Settings (${settingKeys.length})`}
            items={settingKeys.map(humanize)}
            checked={selected.settings}
            onCheckedChange={toggle("settings")}
          />
          <ImportGroup
            title={`Appearance and layout (${layout.length})`}
            items={layout.map(([key]) => LOCAL_STORAGE_LABELS[key] ?? key)}
            checked={selected.layout}
            onCheckedChange={toggle("layout")}
          />
          <ImportGroup
            title="Window zoom"
            items={
              preview.zoomLevel === null
                ? []
                : [`${zoomPercent(preview.currentZoomLevel)} to ${zoomPercent(preview.zoomLevel)}`]
            }
            checked={selected.zoom}
            onCheckedChange={toggle("zoom")}
          />
          <ImportGroup
            title={`Keyboard shortcuts (${preview.keybindingCommands.length})`}
            items={preview.keybindingCommands}
            checked={selected.keybindings}
            onCheckedChange={toggle("keybindings")}
          />
          <ImportGroup
            title={`Custom theme files (${preview.themeFiles.length})`}
            items={preview.themeFiles}
            checked={selected.themes}
            onCheckedChange={toggle("themes")}
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={importing} onClick={props.onClose}>
            Cancel
          </Button>
          <Button disabled={importing || !anySelected} onClick={() => void run()}>
            {importing ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** Desktop only: T3 Code's files and browser storage are read in the main process. */
export function T3ImportSettingsRow() {
  const bridge = window.desktopBridge?.t3Import;
  const [preview, setPreview] = useState<DesktopT3ImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  if (!bridge) return null;

  const open = async () => {
    setLoading(true);
    try {
      setPreview(await bridge.preview());
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not read T3 Code's settings",
          description: error instanceof Error ? error.message : "Something went wrong.",
        }),
      );
    }
    setLoading(false);
  };

  return (
    <>
      <SettingsRow
        {...searchableSetting("import-t3-settings")}
        description="Copy settings, keyboard shortcuts, themes, layout and zoom from T3 Code on this computer. You see everything before it is imported."
        control={
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void open()}>
            Review…
          </Button>
        }
      />
      {preview === null ? null : (
        <T3ImportDialog preview={preview} onClose={() => setPreview(null)} />
      )}
    </>
  );
}
