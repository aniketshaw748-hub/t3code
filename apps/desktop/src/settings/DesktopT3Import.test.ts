import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  changedKeybindingCommands,
  importableClientSettings,
  mergeKeybindings,
  readAppZoomLevel,
} from "./DesktopT3Import.ts";

describe("DesktopT3Import", () => {
  it("imports only saved settings that differ, never account or onboarding state", () => {
    const saved = {
      ...DEFAULT_CLIENT_SETTINGS,
      glassOpacity: 40,
      threadDetailsItems: { usage: true, context: true },
      onboardingCompletedAt: "2026-10-07T08:54:34.117Z",
      favorites: [{ provider: "codex", model: "gpt-6.1-sol" }],
      notAKnownSetting: true,
    };
    expect(
      importableClientSettings(
        { settings: saved },
        { ...DEFAULT_CLIENT_SETTINGS, appMode: "work" },
      ),
    ).toEqual({ glassOpacity: 40, threadDetailsItems: { usage: true, context: true } });
    expect(importableClientSettings({ glassOpacity: 900 }, DEFAULT_CLIENT_SETTINGS)).toEqual({});
  });

  it("replaces only commands bound to other keys, not newer when clauses", () => {
    const ours = [
      { key: "mod+b", command: "sidebar.toggle" },
      { key: "mod+1", command: "thread.jump.1", when: "!modelPickerOpen && isDesktop" },
      { key: "mod+k", command: "commandPalette.toggle" },
    ];
    const theirs = [
      { key: "mod+shift+b", command: "sidebar.toggle" },
      { key: "mod+1", command: "thread.jump.1", when: "isDesktop" },
      { key: "mod+k", command: "commandPalette.toggle" },
      { key: "mod+x", command: "not.a.command" },
    ];
    const commands = changedKeybindingCommands(theirs, ours);
    expect(commands).toEqual(["sidebar.toggle"]);
    expect(mergeKeybindings(theirs, ours, commands)).toEqual([
      ours[1],
      ours[2],
      { key: "mod+shift+b", command: "sidebar.toggle" },
    ]);
  });

  it("reads the app host's saved zoom in either Chromium format", () => {
    expect(readAppZoomLevel({ partition: { per_host_zoom_levels: { "1": { app: 0.5 } } } })).toBe(
      0.5,
    );
    expect(
      readAppZoomLevel({
        partition: { per_host_zoom_levels: { "1": { app: { zoom_level: -0.5 } } } },
      }),
    ).toBe(-0.5);
    expect(readAppZoomLevel({ partition: {} })).toBeNull();
  });
});
