import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime/environment";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import { isShownUnderParent } from "@t3tools/client-runtime/state/threads";
import { DESKTOP_BUBBLE_DISC_SIZE, type DesktopBubbleThreadTarget } from "@t3tools/contracts";
import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { APP_DISPLAY_NAME } from "~/branding";
import { cn } from "~/lib/utils";
import {
  useDelegatedUnderParent,
  useHiddenThreadKeys,
  useProjects,
  useQuietThreadShells,
} from "~/state/entities";
import { BubbleChat } from "./BubbleChat";
import { BubbleDisc } from "./BubbleDisc";
import { bubbleBridge, useBubbleHostState } from "./bubbleHost";
import { BUBBLE_GAP, type BubbleMode, bubbleWindowSize } from "./bubbleLayout";
import { BubbleThreadList } from "./BubbleThreadList";
import { selectBubbleThreads, summarizeBubbleStack } from "./bubbleThreads.logic";

const EXPAND_DELAY_MS = 140;
const COLLAPSE_DELAY_MS = 320;
const DRAG_THRESHOLD_PX = 4;

function useBubbleThreads(sinceMs: number) {
  const shells = useQuietThreadShells();
  const hidden = useHiddenThreadKeys();
  const delegated = useDelegatedUnderParent();
  const projects = useProjects();
  const projectTitles = new Map(
    projects.map((project) => [
      scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
      project.title,
    ]),
  );
  return selectBubbleThreads({
    threads: shells.filter((shell) => {
      const ref = { environmentId: shell.environmentId, threadId: shell.id };
      return !hidden.has(threadKey(ref)) && !isShownUnderParent(ref, shell.lineage, delegated);
    }),
    projectTitle: (shell) =>
      projectTitles.get(scopedProjectKey(scopeProjectRef(shell.environmentId, shell.projectId))) ??
      null,
    sinceMs,
  });
}

function stackLabel(count: number, attentionCount: number): string {
  if (count === 0) return `${APP_DISPLAY_NAME}: no agents running`;
  const agents = `${count} ${count === 1 ? "agent" : "agents"}`;
  return attentionCount > 0
    ? `${APP_DISPLAY_NAME}: ${agents}, ${attentionCount} waiting for you`
    : `${APP_DISPLAY_NAME}: ${agents}`;
}

interface PointerGesture {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  dragging: boolean;
  moveInFlight: boolean;
}

function BubbleUi({ sinceMs }: { readonly sinceMs: number }) {
  const host = useBubbleHostState();
  const threads = useBubbleThreads(sinceMs);
  const summary = summarizeBubbleStack(threads);
  const [mode, setMode] = useState<BubbleMode>("collapsed");
  const [chatTarget, setChatTarget] = useState<DesktopBubbleThreadTarget | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const gesture = useRef<PointerGesture | null>(null);
  const size = bubbleWindowSize(mode, threads.length);
  const zoom = window.desktopBridge?.getWindowZoomFactor() ?? 1;

  const clearHoverTimer = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  const schedule = (delay: number, next: BubbleMode) => {
    clearHoverTimer();
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      setMode(next);
    }, delay);
  };

  // Hover opens the list and leaving closes it; an open chat stays until it is closed.
  const onPointerInside = useEffectEvent((inside: boolean) => {
    if (gesture.current?.dragging) return;
    if (inside && mode === "collapsed") schedule(EXPAND_DELAY_MS, "list");
    else if (!inside && mode === "list") schedule(COLLAPSE_DELAY_MS, "collapsed");
    else clearHoverTimer();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the main process the bubble is drawn so it can show the window
  useEffect(() => {
    void bubbleBridge()?.ready();
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the main process owns the window bounds; it anchors the disc and clamps to the screen
  useEffect(() => {
    void bubbleBridge()?.resize({ width: size.width, height: size.height });
  }, [size.width, size.height]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- transparent pixels click through to the desktop; only painted ones take the pointer
  useEffect(() => {
    let inside: boolean | null = null;
    const update = (next: boolean) => {
      if (next === inside) return;
      inside = next;
      void bubbleBridge()?.setInteractive(next);
      onPointerInside(next);
    };
    const onMove = (event: MouseEvent) => {
      update(event.target instanceof Element && event.target.closest("[data-bubble-hit]") !== null);
    };
    const onLeave = () => update(false);
    document.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const openChat = ({ environmentId, threadId }: DesktopBubbleThreadTarget) => {
    clearHoverTimer();
    setChatTarget({ environmentId, threadId });
    setMode("chat");
  };
  const openFull = (target: DesktopBubbleThreadTarget) => {
    void bubbleBridge()?.openThread(target);
  };
  const restoreApp = () => {
    void bubbleBridge()?.restoreApp();
  };

  const onDiscClick = () => {
    if (mode === "chat") {
      setMode("list");
      return;
    }
    const [only] = threads;
    if (threads.length === 0) restoreApp();
    else if (threads.length === 1 && only) openChat(only);
    else {
      clearHoverTimer();
      setMode("list");
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      dragging: false,
      moveInFlight: false,
    };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    if (!current.dragging) {
      if (
        Math.hypot(event.screenX - current.startX, event.screenY - current.startY) <
        DRAG_THRESHOLD_PX
      ) {
        return;
      }
      current.dragging = true;
      clearHoverTimer();
      setMode("collapsed");
      void bubbleBridge()?.dragStart();
      return;
    }
    // One move in flight at a time; the main process reads the live cursor, so none are lost.
    if (current.moveInFlight) return;
    current.moveInFlight = true;
    void bubbleBridge()
      ?.dragMove()
      .finally(() => {
        current.moveInFlight = false;
      });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (current.dragging) {
      void bubbleBridge()?.dragEnd({
        animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
      return;
    }
    onDiscClick();
  };
  const onPointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = gesture.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (current.dragging) void bubbleBridge()?.dragEnd({ animate: false });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    if (mode === "chat") setMode(threads.length > 0 ? "list" : "collapsed");
    else setMode("collapsed");
  };

  const panelRoom = host.height - DESKTOP_BUBBLE_DISC_SIZE - BUBBLE_GAP;
  // The panel waits for the window to grow, so it never draws clipped in the disc's square.
  const panelShown = mode !== "collapsed" && panelRoom > 0;
  return (
    <div
      className={cn(
        // gap-2 is BUBBLE_GAP, which the window size counts on.
        "flex gap-2 select-none",
        host.vertical === "end" ? "flex-col-reverse" : "flex-col",
        host.horizontal === "end" ? "items-end" : "items-start",
      )}
      // The window is sized in screen pixels, but the page shares the app's zoom (Chromium
      // zooms per origin), so lay out unzoomed: one CSS pixel per window pixel.
      style={{ zoom: 1 / zoom, width: `${100 * zoom}dvw`, height: `${100 * zoom}dvh` }}
      onKeyDown={onKeyDown}
    >
      <BubbleDisc
        summary={summary}
        horizontal={host.horizontal}
        vertical={host.vertical}
        label={stackLabel(summary.count, summary.attentionCount)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
      {panelShown ? (
        <div
          data-bubble-hit
          className={cn(
            "flex min-h-0 flex-col overflow-hidden rounded-2xl surface-popover text-popover-foreground select-text",
            "transition-[opacity,scale,translate] duration-160 ease-out motion-reduce:transition-none starting:scale-[0.97] starting:opacity-0",
            host.horizontal === "end" ? "origin-right" : "origin-left",
          )}
          style={{
            width: Math.min(size.width, host.width),
            maxHeight: panelRoom,
            ...(mode === "chat" ? { height: panelRoom } : {}),
          }}
        >
          {mode === "chat" && chatTarget !== null ? (
            <BubbleChat
              target={chatTarget}
              onClose={() => setMode(threads.length > 0 ? "list" : "collapsed")}
              onOpenFull={() => openFull(chatTarget)}
            />
          ) : (
            <BubbleThreadList threads={threads} onOpenThread={openChat} onRestoreApp={restoreApp} />
          )}
        </div>
      ) : null}
    </div>
  );
}

/** The floating bubble the desktop app shows while its main window is minimized. */
export function BubbleSurface() {
  const host = useBubbleHostState();
  // Each appearance starts collapsed, with only the runs that end from now on listed as new.
  return <BubbleUi key={host.shownAt} sinceMs={host.shownAt} />;
}
