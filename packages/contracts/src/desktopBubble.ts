import * as Schema from "effect/Schema";

import { EnvironmentId, ThreadId } from "./baseSchemas.ts";

/** The square the collapsed bubble occupies, in DIP; the window never gets smaller. */
export const DESKTOP_BUBBLE_DISC_SIZE = 64;

const BubbleDimension = Schema.Int.check(
  Schema.isBetween({ minimum: DESKTOP_BUBBLE_DISC_SIZE, maximum: 1_200 }),
);

/** The window size the bubble renderer asks for; the main process clamps it to the screen. */
export const DesktopBubbleSizeSchema = Schema.Struct({
  width: BubbleDimension,
  height: BubbleDimension,
});
export type DesktopBubbleSize = typeof DesktopBubbleSizeSchema.Type;

/** Which side of its window the disc sits on; panels open toward the other side. */
export const DesktopBubbleEdge = Schema.Literals(["start", "end"]);
export type DesktopBubbleEdge = typeof DesktopBubbleEdge.Type;

export const DesktopBubbleStateSchema = Schema.Struct({
  visible: Schema.Boolean,
  width: Schema.Int,
  height: Schema.Int,
  horizontal: DesktopBubbleEdge,
  vertical: DesktopBubbleEdge,
});
export type DesktopBubbleState = typeof DesktopBubbleStateSchema.Type;

export const DesktopBubbleThreadTargetSchema = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type DesktopBubbleThreadTarget = typeof DesktopBubbleThreadTargetSchema.Type;

/** The floating bubble's controls. The main process ignores calls from any other window. */
export interface DesktopBubbleBridge {
  /** The bubble rendered; the main process shows it if the app is still minimized. */
  ready: () => Promise<void>;
  resize: (size: DesktopBubbleSize) => Promise<void>;
  /** False lets clicks on transparent pixels reach the windows below. */
  setInteractive: (interactive: boolean) => Promise<void>;
  dragStart: () => Promise<void>;
  /** Moves the bubble to the cursor; the main process reads the cursor itself. */
  dragMove: () => Promise<void>;
  dragEnd: (options: { readonly animate: boolean }) => Promise<void>;
  openThread: (target: DesktopBubbleThreadTarget) => Promise<void>;
  restoreApp: () => Promise<void>;
  onState: (listener: (state: DesktopBubbleState) => void) => () => void;
}
