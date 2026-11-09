import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as Electron from "electron";

import {
  DEFAULT_CLIENT_SETTINGS,
  DESKTOP_BUBBLE_DISC_SIZE,
  type DesktopBubbleSize,
  type DesktopBubbleState,
  type DesktopBubbleThreadTarget,
} from "@t3tools/contracts";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as DesktopState from "../app/DesktopState.ts";
import { getDesktopUrl } from "../electron/ElectronProtocol.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { BUBBLE_OPEN_THREAD_REQUEST_CHANNEL, BUBBLE_STATE_CHANNEL } from "../ipc/channels.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopRendererHistory from "../telemetry/DesktopRendererHistory.ts";
import {
  type BubblePoint,
  type BubbleRect,
  bubbleSnapPath,
  defaultBubblePosition,
  resolveBubbleWindowPlacement,
  restoreBubblePosition,
  snapBubbleToEdge,
} from "./bubbleGeometry.ts";

const DISC = DESKTOP_BUBBLE_DISC_SIZE;
const COLLAPSED_SIZE: DesktopBubbleSize = { width: DISC, height: DISC };
const SNAP_FRAME_MS = 16;
const SNAP_FRAMES = 9;

/** Each method takes the calling renderer's webContents id and ignores every renderer but the bubble's. */
export class DesktopBubble extends Context.Service<
  DesktopBubble,
  {
    /** Shows the bubble while this window is minimized; closing it closes the bubble. */
    readonly attachMainWindow: (window: Electron.BrowserWindow) => Effect.Effect<void>;
    readonly ready: (senderId: number) => Effect.Effect<void>;
    readonly resize: (senderId: number, size: DesktopBubbleSize) => Effect.Effect<void>;
    readonly setInteractive: (senderId: number, interactive: boolean) => Effect.Effect<void>;
    readonly dragStart: (senderId: number) => Effect.Effect<void>;
    readonly dragMove: (senderId: number) => Effect.Effect<void>;
    readonly dragEnd: (
      senderId: number,
      options: { readonly animate: boolean },
    ) => Effect.Effect<void>;
    readonly openThread: (
      senderId: number,
      target: DesktopBubbleThreadTarget,
    ) => Effect.Effect<void>;
    readonly restoreApp: (senderId: number) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/bubble/DesktopBubble") {}

const { logInfo, logWarning } = makeComponentLogger("desktop-bubble");

function workAreaNear(point: BubblePoint): BubbleRect {
  return Electron.screen.getDisplayNearestPoint({
    x: Math.round(point.x + DISC / 2),
    y: Math.round(point.y + DISC / 2),
  }).workArea;
}

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopState = yield* DesktopState.DesktopState;
  const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const electronShell = yield* ElectronShell.ElectronShell;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const rendererHistory = yield* DesktopRendererHistory.DesktopRendererHistory;
  const runFork = Effect.runForkWith(yield* Effect.context<never>());

  let main: Electron.BrowserWindow | null = null;
  let bubble: Electron.BrowserWindow | null = null;
  let rendererReady = false;
  let disc: BubblePoint | null = null;
  let size = COLLAPSED_SIZE;
  let dragOffset: BubblePoint | null = null;
  let snapFiber: Fiber.Fiber<void, never> | null = null;

  const liveBubble = () => (bubble !== null && !bubble.isDestroyed() ? bubble : null);
  const liveMain = () => (main !== null && !main.isDestroyed() ? main : null);
  const isBubbleSender = (senderId: number) => liveBubble()?.webContents.id === senderId;

  const stopSnap = () => {
    if (snapFiber === null) return;
    runFork(Fiber.interrupt(snapFiber));
    snapFiber = null;
  };

  const sendState = (
    window: Electron.BrowserWindow,
    horizontal: DesktopBubbleState["horizontal"],
    vertical: DesktopBubbleState["vertical"],
  ) => {
    const bounds = window.getBounds();
    const state: DesktopBubbleState = {
      visible: window.isVisible(),
      width: bounds.width,
      height: bounds.height,
      horizontal,
      vertical,
    };
    window.webContents.send(BUBBLE_STATE_CHANNEL, state);
  };

  // Re-checked on every show: a display can be unplugged while the bubble is hidden.
  const resolveDisc = Effect.gen(function* () {
    const saved = disc ?? (yield* desktopSettings.get).bubblePosition;
    const workAreas = Electron.screen.getAllDisplays().map((display) => display.workArea);
    return (
      restoreBubblePosition(saved, workAreas) ??
      defaultBubblePosition(Electron.screen.getPrimaryDisplay().workArea)
    );
  });

  const place = (window: Electron.BrowserWindow) => {
    if (disc === null) return;
    const placement = resolveBubbleWindowPlacement({ disc, size, workArea: workAreaNear(disc) });
    window.setBounds(placement.bounds);
    sendState(window, placement.horizontal, placement.vertical);
  };

  const createBubble = Effect.gen(function* () {
    const window = yield* electronWindow.create(
      {
        width: DISC,
        height: DISC,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        hasShadow: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        title: environment.displayName,
        ...(environment.platform === "darwin" ? { type: "panel" as const } : {}),
        webPreferences: {
          preload: environment.preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      },
      { auxiliary: true },
    );
    window.setAlwaysOnTop(true, environment.platform === "darwin" ? "floating" : "normal");
    if (environment.platform === "darwin") {
      window.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        // Electron's temporary UIElement transformation would remove the app from the Dock.
        skipTransformProcessType: true,
      });
    }
    yield* rendererHistory.register(window.webContents, { surface: "bubble" });
    window.webContents.setWindowOpenHandler(({ url }) => {
      runFork(electronShell.openExternal(url));
      return { action: "deny" };
    });
    // The bubble route never navigates; links in its replies open in the browser.
    window.webContents.on("will-navigate", (event, url) => {
      event.preventDefault();
      runFork(electronShell.openExternal(url));
    });
    window.webContents.on("render-process-gone", () => {
      if (!window.isDestroyed()) window.destroy();
    });
    window.once("closed", () => {
      if (bubble === window) {
        bubble = null;
        rendererReady = false;
        dragOffset = null;
        stopSnap();
      }
    });
    void window
      .loadURL(`${getDesktopUrl(environment.isDevelopment)}#/bubble`)
      .catch(() => undefined);
    yield* logInfo("bubble window created");
    return window;
  });

  const shouldShow = Effect.gen(function* () {
    const window = liveMain();
    if (window === null || !window.isMinimized() || (yield* Ref.get(desktopState.quitting))) {
      return false;
    }
    return Option.match(yield* clientSettings.get, {
      onNone: () => DEFAULT_CLIENT_SETTINGS.showBubbleWhenMinimized,
      onSome: (settings) => settings.showBubbleWhenMinimized,
    });
  });

  const show = Effect.gen(function* () {
    if (!(yield* shouldShow)) return;
    const existing = liveBubble();
    if (existing === null) {
      bubble = yield* createBubble;
      // ready() shows it once the renderer has drawn, so it never flashes the boot screen.
      return;
    }
    if (!rendererReady) return;
    stopSnap();
    dragOffset = null;
    size = COLLAPSED_SIZE;
    disc = yield* resolveDisc;
    existing.setIgnoreMouseEvents(false);
    existing.showInactive();
    // Windows can drop a hidden window's topmost flag.
    existing.setAlwaysOnTop(true, environment.platform === "darwin" ? "floating" : "normal");
    place(existing);
  }).pipe(
    Effect.catch((error) => logWarning("failed to show bubble", { message: error.message })),
    Effect.withSpan("DesktopBubble.show"),
  );

  const hide = () => {
    const window = liveBubble();
    stopSnap();
    dragOffset = null;
    size = COLLAPSED_SIZE;
    if (window === null || !window.isVisible()) return;
    window.hide();
    place(window);
  };

  const revealMain = Effect.gen(function* () {
    const window = liveMain();
    if (window !== null) yield* electronWindow.reveal(window);
  });

  const forBubble = (
    senderId: number,
    run: (window: Electron.BrowserWindow) => Effect.Effect<void>,
  ) =>
    Effect.suspend(() => {
      const window = liveBubble();
      return window !== null && isBubbleSender(senderId) ? run(window) : Effect.void;
    });

  return DesktopBubble.of({
    attachMainWindow: Effect.fn("DesktopBubble.attachMainWindow")(function (window) {
      return Effect.sync(() => {
        main = window;
        window.on("minimize", () => {
          runFork(show);
        });
        window.on("restore", hide);
        window.on("show", hide);
        window.on("focus", hide);
        window.once("closed", () => {
          if (main === window) main = null;
          // Windows quits on window-all-closed, so the bubble must not outlive the main window.
          liveBubble()?.destroy();
        });
      });
    }),
    ready: Effect.fn("DesktopBubble.ready")(function* (senderId) {
      if (!isBubbleSender(senderId)) return;
      rendererReady = true;
      yield* show;
    }),
    resize: Effect.fn("DesktopBubble.resize")(function* (senderId, nextSize) {
      yield* forBubble(senderId, (window) =>
        Effect.sync(() => {
          if (dragOffset !== null || !window.isVisible()) return;
          size = nextSize;
          place(window);
        }),
      );
    }),
    setInteractive: Effect.fn("DesktopBubble.setInteractive")(function* (senderId, interactive) {
      yield* forBubble(senderId, (window) =>
        Effect.sync(() => {
          window.setIgnoreMouseEvents(!interactive, { forward: true });
        }),
      );
    }),
    dragStart: Effect.fn("DesktopBubble.dragStart")(function* (senderId) {
      yield* forBubble(senderId, (window) =>
        Effect.sync(() => {
          if (disc === null || !window.isVisible()) return;
          stopSnap();
          size = COLLAPSED_SIZE;
          place(window);
          const cursor = Electron.screen.getCursorScreenPoint();
          dragOffset = { x: cursor.x - disc.x, y: cursor.y - disc.y };
        }),
      );
    }),
    dragMove: Effect.fn("DesktopBubble.dragMove")(function* (senderId) {
      yield* forBubble(senderId, (window) =>
        Effect.sync(() => {
          if (dragOffset === null) return;
          const cursor = Electron.screen.getCursorScreenPoint();
          disc = { x: cursor.x - dragOffset.x, y: cursor.y - dragOffset.y };
          // Explicit size: crossing displays with different scaling can resize a moved window.
          window.setBounds({ x: disc.x, y: disc.y, width: DISC, height: DISC });
        }),
      );
    }),
    dragEnd: Effect.fn("DesktopBubble.dragEnd")(function* (senderId, options) {
      yield* forBubble(senderId, (window) =>
        Effect.gen(function* () {
          if (dragOffset === null || disc === null) return;
          dragOffset = null;
          const from = disc;
          const target = snapBubbleToEdge(from, workAreaNear(from));
          disc = target;
          const finish = Effect.sync(() => {
            snapFiber = null;
            if (!window.isDestroyed()) place(window);
          });
          snapFiber = runFork(
            (options.animate
              ? Effect.forEach(
                  bubbleSnapPath(from, target, SNAP_FRAMES),
                  (point) =>
                    Effect.sync(() => {
                      if (!window.isDestroyed()) {
                        window.setBounds({ ...point, width: DISC, height: DISC });
                      }
                    }).pipe(Effect.andThen(Effect.sleep(SNAP_FRAME_MS))),
                  { discard: true },
                ).pipe(Effect.andThen(finish))
              : finish
            ).pipe(Effect.asVoid),
          );
          yield* desktopSettings
            .setBubblePosition(target)
            .pipe(
              Effect.catch((error) =>
                logWarning("failed to save bubble position", { message: error.message }),
              ),
            );
        }),
      );
    }),
    openThread: Effect.fn("DesktopBubble.openThread")(function* (senderId, target) {
      const window = liveMain();
      if (!isBubbleSender(senderId) || window === null) return;
      window.webContents.send(BUBBLE_OPEN_THREAD_REQUEST_CHANNEL, target);
      yield* revealMain;
    }),
    restoreApp: Effect.fn("DesktopBubble.restoreApp")(function* (senderId) {
      if (!isBubbleSender(senderId)) return;
      yield* revealMain;
    }),
  });
});

export const layer = Layer.effect(DesktopBubble, make);
