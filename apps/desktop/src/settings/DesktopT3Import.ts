import {
  ClientSettingsPatch,
  ClientSettingsSchema,
  type DesktopT3ImportPreview,
  type DesktopT3ImportSelection,
  KeybindingRule,
} from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { readChromiumLocalStorage } from "../app/chromiumLocalStorage.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopClientSettings from "./DesktopClientSettings.ts";

/** Where official T3 Code keeps its data. Only ever read: nothing here writes to it. */
const T3_CODE = {
  homeDirName: ".t3",
  userDataDirName: "t3code-v2",
  origin: "t3code://app",
} as const;

/** Tied to provider accounts, projects, browser profiles or onboarding, so they stay as they are. */
const EXCLUDED_CLIENT_SETTINGS = new Set<string>([
  "appMode",
  "onboardingCompletedAt",
  "favorites",
  "providerModelPreferences",
  "loadBalancingEnabled",
  "loadBalancingWeights",
  "browserProfiles",
  "browserDefaultProfileId",
  "pullRequestMergeMethodOverrides",
  "sidebarProjectGroupingOverrides",
  "voiceMicrophone",
]);

/** Appearance and layout choices kept in browser storage. Never drafts, history or tokens. */
const T3_IMPORT_LOCAL_STORAGE_KEYS = [
  "t3code:theme",
  "t3code:themes:v1",
  "t3code:theme-follow-system",
  "t3code:theme-appearance-mode",
  "t3code:theme-halves:v1",
  "t3code:typography-advanced",
  "chat_thread_sidebar_width",
  "t3code:preview-panel-width",
  "t3code:last-editor",
  "t3code:sidebar:settled-expanded",
  "t3code:sidebar:snoozed-expanded",
  "t3code:sidebar:working-expanded",
] as const;

const JsonDocument = fromLenientJson(Schema.Unknown);
const decodeJson = Schema.decodeUnknownOption(JsonDocument);
const decodeClientSettings = Schema.decodeUnknownOption(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownOption(ClientSettingsPatch);
const isKeybindingRule = Schema.is(KeybindingRule);

type Rule = { readonly key: string; readonly command: string };
const isRule = (value: unknown): value is Rule =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Rule).key === "string" &&
  typeof (value as Rule).command === "string";

/** The saved client settings worth importing that differ from `current`. */
export function importableClientSettings(
  raw: unknown,
  current: Record<string, unknown>,
): ClientSettingsPatch {
  const document =
    typeof raw === "object" && raw !== null && "settings" in raw
      ? (raw as { settings: unknown }).settings
      : raw;
  if (typeof document !== "object" || document === null) return {};
  const decoded = Option.getOrUndefined(decodeClientSettings(document)) as
    | Record<string, unknown>
    | undefined;
  if (decoded === undefined) return {};
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(document)) {
    if (EXCLUDED_CLIENT_SETTINGS.has(key) || !(key in decoded)) continue;
    if (JSON.stringify(decoded[key]) === JSON.stringify(current[key])) continue;
    patch[key] = decoded[key];
  }
  return Option.getOrElse(decodeClientSettingsPatch(patch), () => ({}));
}

const keysByCommand = (rules: ReadonlyArray<unknown>) => {
  const keys = new Map<string, Set<string>>();
  for (const rule of rules.filter(isRule)) {
    keys.set(rule.command, (keys.get(rule.command) ?? new Set<string>()).add(rule.key));
  }
  return new Map([...keys].map(([command, set]) => [command, [...set].toSorted().join("\n")]));
};

/**
 * Commands T3 Code binds to other keys. Rules that only differ in their `when` clause are left
 * alone: those are default changes between versions, not the user's choices.
 */
export function changedKeybindingCommands(
  source: ReadonlyArray<unknown>,
  current: ReadonlyArray<unknown>,
): ReadonlyArray<string> {
  const ours = keysByCommand(current);
  return [...keysByCommand(source.filter(isKeybindingRule))]
    .filter(([command, keys]) => ours.get(command) !== keys)
    .map(([command]) => command)
    .toSorted();
}

/** Takes T3 Code's rules for `commands` and keeps every other rule of ours. */
export function mergeKeybindings(
  source: ReadonlyArray<unknown>,
  current: ReadonlyArray<unknown>,
  commands: ReadonlyArray<string>,
): ReadonlyArray<unknown> {
  const replaced = new Set(commands);
  return [
    ...current.filter((rule) => !isRule(rule) || !replaced.has(rule.command)),
    ...source.filter((rule) => isKeybindingRule(rule) && replaced.has(rule.command)),
  ];
}

const formatKeybindingsFile = (rules: ReadonlyArray<unknown>) =>
  `${JSON.stringify(rules, null, 2)}\n`;

/** Chromium saves zoom per host; the app is served from the `app` host. */
export function readAppZoomLevel(preferences: unknown): number | null {
  const partitions = (preferences as { partition?: { per_host_zoom_levels?: unknown } })?.partition
    ?.per_host_zoom_levels;
  if (typeof partitions !== "object" || partitions === null) return null;
  for (const hosts of Object.values(partitions)) {
    const level = (hosts as Record<string, unknown> | null)?.app;
    if (typeof level === "number") return level;
    const nested = (level as { zoom_level?: unknown } | undefined)?.zoom_level;
    if (typeof nested === "number") return nested;
  }
  return null;
}

export class DesktopT3Import extends Context.Service<
  DesktopT3Import,
  {
    readonly preview: (currentZoomLevel: number) => Effect.Effect<DesktopT3ImportPreview>;
    /** Writes keybindings and themes; zoom and renderer state are applied by the caller. */
    readonly apply: (selection: DesktopT3ImportSelection) => Effect.Effect<{
      readonly zoomLevel: number | null;
    }>;
  }
>()("@t3tools/desktop/settings/DesktopT3Import") {}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;

  const sourceDir = path.join(environment.homeDirectory, T3_CODE.homeDirName, "userdata");
  const sourceProfile = path.join(environment.appDataDirectory, T3_CODE.userDataDirName);
  const keybindingsPath = path.join(environment.stateDir, "keybindings.json");
  const themesDir = path.join(environment.stateDir, "themes");

  const readText = (file: string) => fs.readFileString(file).pipe(Effect.option);
  const readJson = (file: string) =>
    readText(file).pipe(Effect.map(Option.flatMap((text) => decodeJson(text))));
  const readRules = (file: string) =>
    readJson(file).pipe(
      Effect.map((json) =>
        Option.match(json, {
          onNone: () => [] as ReadonlyArray<unknown>,
          onSome: (value) => (Array.isArray(value) ? value : []),
        }),
      ),
    );

  const changedThemeFiles = Effect.gen(function* () {
    const names = yield* fs
      .readDirectory(path.join(sourceDir, "themes"))
      .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
    const changed: Array<string> = [];
    for (const name of names.filter((entry) => entry.endsWith(".json")).toSorted()) {
      const source = yield* readText(path.join(sourceDir, "themes", name));
      const ours = yield* readText(path.join(themesDir, name));
      if (Option.isSome(source) && Option.getOrUndefined(ours) !== source.value) {
        changed.push(name);
      }
    }
    return changed;
  });

  const keybindingCommands = Effect.gen(function* () {
    const source = yield* readRules(path.join(sourceDir, "keybindings.json"));
    return changedKeybindingCommands(source, yield* readRules(keybindingsPath));
  });

  const readZoomLevel = readJson(path.join(sourceProfile, "Preferences")).pipe(
    Effect.map((json) => Option.match(json, { onNone: () => null, onSome: readAppZoomLevel })),
  );

  const preview = Effect.fn("desktop.t3Import.preview")(function* (currentZoomLevel: number) {
    if (!(yield* fs.exists(sourceDir).pipe(Effect.orElseSucceed(() => false)))) {
      return {
        sourceDir: null,
        clientSettings: {},
        keybindingCommands: [],
        themeFiles: [],
        localStorage: {},
        zoomLevel: null,
        currentZoomLevel,
      } satisfies DesktopT3ImportPreview;
    }
    const current = Option.getOrUndefined(
      yield* clientSettings.get.pipe(Effect.orElseSucceed(() => Option.none())),
    );
    const raw = yield* readJson(path.join(sourceDir, "client-settings.json"));
    const storage = yield* readChromiumLocalStorage(
      path.join(sourceProfile, "Local Storage", "leveldb"),
      T3_CODE.origin,
    ).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.orElseSucceed(() => new Map<string, string>()),
    );
    const zoomLevel = yield* readZoomLevel;
    return {
      sourceDir,
      clientSettings: Option.match(raw, {
        onNone: () => ({}),
        onSome: (value) =>
          importableClientSettings(value, (current ?? {}) as Record<string, unknown>),
      }),
      keybindingCommands: yield* keybindingCommands,
      themeFiles: yield* changedThemeFiles,
      localStorage: Object.fromEntries(
        T3_IMPORT_LOCAL_STORAGE_KEYS.flatMap((key) => {
          const value = storage.get(key);
          return value === undefined ? [] : [[key, value] as const];
        }),
      ),
      zoomLevel: zoomLevel === currentZoomLevel ? null : zoomLevel,
      currentZoomLevel,
    } satisfies DesktopT3ImportPreview;
  });

  /** Temp file then rename, so the server's watcher never reads half a file. */
  const writeAtomic = (file: string, contents: string) =>
    fs
      .makeDirectory(path.dirname(file), { recursive: true })
      .pipe(
        Effect.andThen(fs.writeFileString(`${file}.import-tmp`, contents)),
        Effect.andThen(fs.rename(`${file}.import-tmp`, file)),
      );

  const apply = Effect.fn("desktop.t3Import.apply")(function* (
    selection: DesktopT3ImportSelection,
  ) {
    if (selection.keybindings) {
      const source = yield* readRules(path.join(sourceDir, "keybindings.json"));
      const current = yield* readRules(keybindingsPath);
      const commands = changedKeybindingCommands(source, current);
      if (commands.length > 0) {
        yield* writeAtomic(
          keybindingsPath,
          formatKeybindingsFile(mergeKeybindings(source, current, commands)),
        ).pipe(Effect.catch((error) => Effect.logWarning("Could not import keybindings", error)));
      }
    }
    if (selection.themes) {
      for (const name of yield* changedThemeFiles) {
        const contents = yield* readText(path.join(sourceDir, "themes", name));
        if (Option.isNone(contents)) continue;
        yield* writeAtomic(path.join(themesDir, name), contents.value).pipe(
          Effect.catch((error) => Effect.logWarning("Could not import a theme", error)),
        );
      }
    }
    return { zoomLevel: selection.zoom ? yield* readZoomLevel : null };
  });

  return DesktopT3Import.of({ preview, apply });
});

export const layer = Layer.effect(DesktopT3Import, make);
