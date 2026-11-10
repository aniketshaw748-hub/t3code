import {
  DeliverableId,
  DeliverableNoteId,
  DeliverableVersionId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type Deliverable,
  type DeliverableAnchor,
  type DeliverableComparison,
  type DeliverableNote,
  type DeliverableRendition,
  type DeliverableVersion,
  type WorkProjectSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { AsyncResult } from "effect/reactivity";
import { useState, type CSSProperties, type ReactNode } from "react";

/**
 * What a Work screen needs to render under jsdom: DOM stand-ins for the native modules its
 * components import, a scene of project data the mocked hooks read, and a record of what the
 * screen asked the host to do. A test finds things by accessibility label, presses them, and
 * drives the touch responder a finger would.
 */

type Style = CSSProperties | ReadonlyArray<Style | null | undefined | false> | null | undefined;

const flatten = (style: Style | false): CSSProperties =>
  !style
    ? {}
    : Array.isArray(style)
      ? Object.assign({}, ...style.map(flatten))
      : (style as CSSProperties);

interface TouchPoint {
  readonly locationX: number;
  readonly locationY: number;
}

interface ResponderProps {
  readonly onLayout?: (event: {
    nativeEvent: { layout: { x: number; y: number; width: number; height: number } };
  }) => void;
  readonly onResponderGrant?: (event: { nativeEvent: TouchPoint }) => void;
  readonly onResponderMove?: (event: { nativeEvent: TouchPoint }) => void;
  readonly onResponderRelease?: (event: { nativeEvent: TouchPoint }) => void;
}

interface ViewProps extends ResponderProps {
  readonly children?: ReactNode;
  readonly className?: string;
  readonly style?: Style;
  readonly accessibilityLabel?: string;
  readonly accessibilityRole?: string;
  readonly accessibilityState?: { readonly selected?: boolean; readonly disabled?: boolean };
  readonly testID?: string;
}

// Views that take touches or report layout, by label or test id, for `layout` and `drag` below.
const responders = new Map<string, ResponderProps>();

function View(props: ViewProps) {
  const name = props.accessibilityLabel ?? props.testID;
  if (name && (props.onLayout || props.onResponderGrant)) responders.set(name, props);
  return (
    <div
      aria-label={props.accessibilityLabel}
      role={props.accessibilityRole}
      className={props.className}
      style={flatten(props.style)}
    >
      {props.children}
    </div>
  );
}

function Pressable(
  props: ViewProps & { readonly onPress?: () => void; readonly disabled?: boolean },
) {
  return (
    <button
      type="button"
      aria-label={props.accessibilityLabel}
      aria-pressed={props.accessibilityState?.selected}
      disabled={props.disabled}
      onClick={props.onPress}
      className={props.className}
      style={flatten(props.style)}
    >
      {typeof props.children === "function"
        ? (props.children as (state: { pressed: boolean }) => ReactNode)({ pressed: false })
        : props.children}
    </button>
  );
}

function Text(props: ViewProps & { readonly numberOfLines?: number }) {
  return (
    <span
      aria-label={props.accessibilityLabel}
      role={props.accessibilityRole}
      className={props.className}
      style={flatten(props.style)}
      data-lines={props.numberOfLines}
    >
      {props.children}
    </span>
  );
}

function TextInput(props: {
  readonly accessibilityLabel?: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly readOnly?: boolean;
  readonly className?: string;
  readonly onChangeText?: (text: string) => void;
}) {
  return (
    <textarea
      aria-label={props.accessibilityLabel}
      placeholder={props.placeholder}
      readOnly={props.readOnly}
      className={props.className}
      value={props.value ?? ""}
      onChange={(event) => props.onChangeText?.(event.currentTarget.value)}
    />
  );
}

/** What a test hands `vi.mock("react-native")`: the primitives Work's components import. */
export const reactNativeDom = {
  View,
  Pressable,
  Text,
  TextInput,
  ScrollView: (
    props: ViewProps & {
      readonly contentContainerClassName?: string;
      readonly horizontal?: boolean;
    },
  ) => (
    <View
      {...props}
      className={[props.className, props.contentContainerClassName].join(" ")}
      style={[props.style, props.horizontal ? { flexDirection: "row" } : null]}
    />
  ),
  ActivityIndicator: () => <span role="progressbar" />,
  Alert: { alert: () => {} },
  Keyboard: { dismiss: () => {} },
  Platform: { OS: "ios", Version: 26 },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 }),
};

/** Gives the view labelled `label` a size, as its first layout pass would. */
export function layout(label: string, size: { readonly width: number; readonly height: number }) {
  const view = responders.get(label);
  if (!view?.onLayout) throw new Error(`No view labelled "${label}" reports layout.`);
  view.onLayout({ nativeEvent: { layout: { x: 0, y: 0, ...size } } });
}

type Point = readonly [x: number, y: number];

/** One finger down at `from`, moved through `through`, lifted at the last point. */
export function drag(label: string, from: Point, ...through: ReadonlyArray<Point>) {
  const at = ([locationX, locationY]: Point) => ({ nativeEvent: { locationX, locationY } });
  // Read again for each event: a move re-renders the view with new handlers.
  const view = () => {
    const found = responders.get(label);
    if (!found?.onResponderGrant) throw new Error(`No view labelled "${label}" takes touches.`);
    return found;
  };
  view().onResponderGrant?.(at(from));
  for (const point of through) view().onResponderMove?.(at(point));
  view().onResponderRelease?.(at(through[through.length - 1] ?? from));
}

/** The app's own pieces that reach for a native view, a navigator or the keyboard. */
export const appDom = {
  uniwind: {
    withUniwind: <Props,>(Component: (props: Props) => ReactNode) => Component,
    useResolveClassNames: () => ({}),
  },
  symbol: {
    SymbolView: (props: { readonly name: unknown; readonly tintColorClassName?: string }) => (
      <span
        data-symbol={typeof props.name === "string" ? props.name : "symbol"}
        className={props.tintColorClassName}
      />
    ),
  },
  image: {
    Image: (props: {
      readonly source?: { readonly uri?: string };
      readonly accessibilityLabel?: string;
      readonly style?: Style;
    }) => (
      <img
        src={props.source?.uri}
        alt={props.accessibilityLabel ?? ""}
        style={flatten(props.style)}
      />
    ),
  },
  video: {
    VideoView: (props: { readonly accessibilityLabel?: string }) => (
      <div aria-label={props.accessibilityLabel} />
    ),
    useVideoPlayer: () => ({
      playing: false,
      currentTime: 0,
      duration: Number.NaN,
      play: () => {},
      pause: () => {},
      seekBy: () => {},
    }),
  },
  expo: { useEvent: <Value,>(_source: unknown, _event: string, initial: Value) => initial },
  glass: { GlassView: View, GlassContainer: View, isGlassEffectAPIAvailable: () => false },
  navigation: {
    useNavigation: () => ({
      goBack: () => {},
      dispatch: (action: unknown) => host.record("navigate", action),
    }),
    useIsFocused: () => true,
    StackActions: { push: (name: string, params: unknown) => ({ name, params }) },
  },
  keyboard: { KeyboardAvoidingView: View, useKeyboardState: () => false },
  safeArea: { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
  appBar: {
    AppBar: (props: {
      readonly title: string;
      readonly subtitle?: string | null;
      readonly actions?: ReadonlyArray<{
        readonly accessibilityLabel: string;
        readonly onPress: () => void;
      }>;
    }) => (
      <header>
        <h1>{props.title}</h1>
        {props.subtitle ? <p>{props.subtitle}</p> : null}
        {props.actions?.map((action) => (
          <button
            key={action.accessibilityLabel}
            type="button"
            aria-label={action.accessibilityLabel}
            onClick={action.onPress}
          />
        ))}
      </header>
    ),
  },
  screenContent: { ScreenContent: (props: { readonly children: ReactNode }) => props.children },
  settingsScreen: {
    SettingsScreen: (props: {
      readonly title: string;
      readonly subtitle?: string | null;
      readonly children: ReactNode;
    }) => (
      <main>
        <h1>{props.title}</h1>
        {props.subtitle ? <p>{props.subtitle}</p> : null}
        {props.children}
      </main>
    ),
  },
  screenScrollView: { ScreenScrollView: reactNativeDom.ScrollView },
  dialog: { alert: (title: string, message?: string) => host.record("alert", { title, message }) },
  segmentedControl: {
    SegmentedControl: <Value extends string | number>(props: {
      readonly options: ReadonlyArray<{ readonly value: Value; readonly label: string }>;
      readonly selected: Value;
      readonly onSelect: (value: Value) => void;
    }) => (
      <div role="tablist">
        {props.options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={option.value === props.selected}
            onClick={() => props.onSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    ),
  },
  listRow: {
    ListRow: (props: {
      readonly label: string;
      readonly detail?: string;
      readonly onPress: () => void;
    }) => (
      <button type="button" onClick={props.onPress}>
        {props.label}
        {props.detail ? ` ${props.detail}` : ""}
      </button>
    ),
  },
  composerToolbar: {
    ComposerToolbarRow: View,
    ComposerInlineControl: (props: {
      readonly label: string;
      readonly selected?: boolean;
      readonly disabled?: boolean;
      readonly onPress?: () => void;
    }) => (
      <button
        type="button"
        aria-pressed={Boolean(props.selected)}
        disabled={props.disabled}
        onClick={props.onPress}
      >
        {props.label}
      </button>
    ),
    ComposerActionButton: (props: {
      readonly accessibilityLabel: string;
      readonly disabled?: boolean;
      readonly onPress: () => void;
    }) => (
      <button
        type="button"
        aria-label={props.accessibilityLabel}
        disabled={props.disabled}
        onClick={props.onPress}
      />
    ),
  },
  voiceController: {
    useVoiceInputController: () => ({
      isAvailable: false,
      state: { phase: "idle" },
      elapsedSeconds: 0,
      audioLevels: [],
      blocksSubmission: false,
      freezesEditor: false,
      start: () => {},
      stop: () => {},
      cancel: () => {},
    }),
  },
  voiceControls: {
    ComposerDictationCancelAction: () => null,
    ComposerDictationError: () => null,
    ComposerDictationPrimaryAction: () => null,
    ComposerDictationStartAction: () => null,
    ComposerDictationStatus: () => null,
    ComposerDictationToolbar: (props: { readonly children: ReactNode }) => props.children,
  },
  nativeGlass: { NATIVE_LIQUID_GLASS_SUPPORTED: false },
  // The note draft lives in component state here; the app keeps it in an atom per project.
  atoms: {
    useAtom: () => useState(""),
    useAtomValue: (atom: { readonly value?: unknown }) => atom.value,
  },
  atomRegistry: { appAtomRegistry: { get: () => "", subscribe: () => () => {} } },
};

const ENVIRONMENT = EnvironmentId.make("env-1");
const PROJECT = ProjectId.make("project-1");
const THREAD = ThreadId.make("thread-1");
const AT = DateTime.makeUnsafe("2026-11-10T09:00:00.000Z");

export const WORK_TARGET = { environmentId: ENVIRONMENT, projectId: PROJECT };

/** What the mocked data hooks hand a screen. */
export interface WorkScene {
  readonly snapshot: WorkProjectSnapshot | null;
  readonly renditions: ReadonlyArray<DeliverableRendition>;
  /** The Work thread, as loosely as a test cares to describe it; `source` is its server shell. */
  readonly thread: {
    readonly source: Readonly<Record<string, unknown>>;
    readonly [field: string]: unknown;
  } | null;
  readonly busy: boolean;
  readonly canOperate: boolean;
  /** What the server says changed between any two versions; left out, it is still asking. */
  readonly comparison?: DeliverableComparison;
}

interface HostCall {
  readonly command: string;
  readonly input: unknown;
}

const host = {
  scene: null as WorkScene | null,
  calls: [] as HostCall[],
  record(command: string, input: unknown) {
    host.calls.push({ command, input });
  },
};

/** Forgets the views earlier renders registered for `layout` and `drag`. */
export function resetWorkTestDom() {
  responders.clear();
}

/** Sets the project a screen renders and forgets what earlier tests did. */
export function setWorkScene(scene: WorkScene) {
  host.scene = scene;
  host.calls = [];
  responders.clear();
}

/** What the screen asked the host to do, in order: `createNote`, `sendMessage`, `sendNotes`… */
export const hostCalls = (command: string) =>
  host.calls.filter((call) => call.command === command).map((call) => call.input);

const scene = () => {
  if (host.scene === null) throw new Error("Call setWorkScene before rendering a Work screen.");
  return host.scene;
};

const succeed = <Value,>(value: Value) => ({ _tag: "Success" as const, value });

/** A command whose result is `result(input)`; it records that it ran. */
const command = (name: string, result: (input: never) => unknown = () => undefined) =>
  Object.assign(
    async (request: { readonly input: unknown }) => {
      host.record(name, request.input);
      return succeed(result(request.input as never));
    },
    { permissionAtom: () => ({ value: true }) },
  );

/** The app's state modules, reading the scene and recording commands. */
export const workState = {
  data: {
    useWorkProjects: () => [
      { ...WORK_TARGET, id: PROJECT, title: "Launch film", kind: "work", updatedAt: "" },
    ],
    useWorkProjectSnapshot: () => scene().snapshot,
    useWorkThreads: () => (scene().thread === null ? [] : [{ id: THREAD, ...scene().thread }]),
    isThreadBusy: (thread: unknown) => thread != null && scene().busy,
    useWorkAssetUrl: () => (url: string | null | undefined) => url ?? null,
    useRendition: (_environmentId: unknown, versionId: DeliverableVersionId | null) =>
      scene().renditions.find((rendition) => rendition.versionId === versionId) ?? null,
    useLatestAgentText: () => null,
    useThreadMessages: () => [],
    useAgentProgress: () => ({ step: null, renderPercent: null }),
    usePendingSpendApprovals: () => [],
    useWorkPendingRequests: () => null,
    useComparison: () => {
      const { comparison } = scene();
      return {
        result: comparison === undefined ? AsyncResult.initial() : AsyncResult.success(comparison),
        comparison: comparison ?? null,
        retry: () => host.record("retryComparison", null),
      };
    },
  },
  actions: {
    useSendWorkMessage: () => async (message: { readonly text: string }) => {
      host.record("sendMessage", message.text);
      return THREAD;
    },
    useSendNotes: () => async (input: { readonly notes: ReadonlyArray<DeliverableNote> }) => {
      host.record("sendNotes", input.notes);
      return true;
    },
    useStartWorkProject: () => async () => PROJECT,
  },
  useAtomCommand: { useAtomCommand: <Command,>(run: Command) => run },
  work: {
    workEnvironment: {
      createNote: command("createNote", (input: Parameters<typeof workNote>[0]) =>
        workNote({ ...input, id: "note-new" }),
      ),
      setNoteStatus: command("setNoteStatus"),
      deleteNote: command("deleteNote"),
      undo: command("undo"),
      redo: command("redo"),
      restore: command("restore"),
      resolveStray: command("resolveStray"),
      retryRendition: command("retryRendition"),
    },
  },
  server: { serverEnvironment: { answerSpendApproval: command("answerSpendApproval") } },
  threads: {
    threadEnvironment: {
      respondToApproval: command("respondToApproval"),
      respondToUserInput: command("respondToUserInput"),
    },
  },
  entities: { useProject: () => ({ title: "Launch film" }) },
  session: { useEnvironmentScope: () => scene().canOperate },
  environments: {
    useEnvironments: () => ({
      environments: [{ environmentId: ENVIRONMENT, connection: { phase: "available" } }],
    }),
  },
};

export function workDeliverable(input: {
  readonly kind: Deliverable["kind"];
  readonly title: string;
  readonly currentVersion: string;
}): Deliverable {
  return {
    id: DeliverableId.make("deliverable-1"),
    projectId: PROJECT,
    kind: input.kind,
    path: input.title,
    title: input.title,
    currentVersionId: DeliverableVersionId.make(input.currentVersion),
    versionCount: 1,
    createdAt: AT,
    updatedAt: AT,
  } as Deliverable;
}

export function workVersion(input: {
  readonly id: string;
  readonly ordinal: number;
  readonly parent?: string;
  readonly summary?: string;
}): DeliverableVersion {
  return {
    id: DeliverableVersionId.make(input.id),
    deliverableId: DeliverableId.make("deliverable-1"),
    ordinal: input.ordinal,
    parentVersionId: input.parent === undefined ? null : DeliverableVersionId.make(input.parent),
    summary: input.summary ?? null,
    expectedChanges: [],
    renditionStatus: "ready",
    selfCheck: null,
    createdAt: AT,
  } as unknown as DeliverableVersion;
}

export function workNote(input: {
  readonly id?: string;
  readonly versionId: string;
  readonly anchor: DeliverableAnchor | null;
  readonly body: string;
  readonly status?: DeliverableNote["status"];
  readonly fixedIn?: string;
  readonly reply?: string;
  readonly snapshotUrl?: string;
}): DeliverableNote {
  return {
    id: DeliverableNoteId.make(input.id ?? "note-1"),
    deliverableId: DeliverableId.make("deliverable-1"),
    versionId: DeliverableVersionId.make(input.versionId),
    anchor: input.anchor,
    checkAnchor: null,
    body: input.body,
    author: { kind: "user" },
    status: input.status ?? "open",
    snapshotUrl: input.snapshotUrl ?? null,
    sentMessageId: null,
    sentRunId: null,
    fixedInVersionId: input.fixedIn === undefined ? null : DeliverableVersionId.make(input.fixedIn),
    reply: input.reply ?? null,
    createdAt: AT,
    updatedAt: AT,
  } as unknown as DeliverableNote;
}

export function workRendition(input: {
  readonly versionId: string;
  readonly units: number;
  readonly unitKind: "slide" | "shot";
  readonly durationSeconds?: number;
  /** Set for a render that ended without a preview: why, in the server's words. */
  readonly failed?: string;
}): DeliverableRendition {
  return {
    versionId: DeliverableVersionId.make(input.versionId),
    status: input.failed === undefined ? "ready" : "failed",
    renderer: null,
    detail: input.failed ?? null,
    width: 1280,
    height: 720,
    durationSeconds: input.durationSeconds ?? null,
    sourceUrl: `/media/${input.versionId}/source`,
    posterUrl: `/media/${input.versionId}/poster.png`,
    proxyUrl: null,
    units: Array.from({ length: input.units }, (_, index) => ({
      index,
      kind: input.unitKind,
      title: `Part ${index + 1}`,
      imageUrl: `/media/${input.versionId}/${index}.png`,
      thumbUrl: null,
    })),
  };
}

export function workSnapshot(input: {
  readonly deliverable: Deliverable;
  readonly versions: ReadonlyArray<DeliverableVersion>;
  readonly notes?: ReadonlyArray<DeliverableNote>;
}): WorkProjectSnapshot {
  return {
    projectId: PROJECT,
    deliverables: [input.deliverable],
    versions: input.versions,
    notes: input.notes ?? [],
    posters: input.versions.map((version) => ({
      versionId: version.id,
      url: `/media/${version.id}/poster.png`,
    })),
    reviews: [],
  } as unknown as WorkProjectSnapshot;
}
