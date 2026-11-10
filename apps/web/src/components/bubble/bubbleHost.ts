import {
  DESKTOP_BUBBLE_DISC_SIZE,
  type DesktopBubbleBridge,
  type DesktopBubbleState,
} from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

export interface BubbleHostState extends DesktopBubbleState {
  /** When the bubble last appeared; runs that end after this stay listed until opened. */
  readonly shownAt: number;
}

let snapshot: BubbleHostState = {
  visible: false,
  width: DESKTOP_BUBBLE_DISC_SIZE,
  height: DESKTOP_BUBBLE_DISC_SIZE,
  horizontal: "end",
  vertical: "end",
  shownAt: Date.now(),
};
const listeners = new Set<() => void>();

export function bubbleBridge(): DesktopBubbleBridge | null {
  return window.desktopBridge?.bubble ?? null;
}

/** Mirrors the window state the main process sends; runs for the life of the bubble page. */
export function startBubbleHost(): () => void {
  return (
    bubbleBridge()?.onState((state) => {
      snapshot = {
        ...state,
        shownAt: state.visible && !snapshot.visible ? Date.now() : snapshot.shownAt,
      };
      for (const listener of listeners) listener();
    }) ?? (() => {})
  );
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => snapshot;

export function useBubbleHostState(): BubbleHostState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Zooming changes the CSS viewport, so a resize also signals a zoom change.
const subscribeToZoom = (onChange: () => void) => {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
};
const readZoomFactor = () => window.desktopBridge?.getWindowZoomFactor() ?? 1;

/**
 * The zoom the bubble page is drawn at. Chromium zooms per origin, so the bubble inherits the
 * main window's zoom, while its own window is sized in screen pixels.
 */
export function useBubbleZoomFactor(): number {
  return useSyncExternalStore(subscribeToZoom, readZoomFactor, readZoomFactor);
}
