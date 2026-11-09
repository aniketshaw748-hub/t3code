import { DesktopBubbleSizeSchema, DesktopBubbleThreadTargetSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopBubble from "../../bubble/DesktopBubble.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const senderId = (event: DesktopIpc.DesktopIpcInvokeEvent | undefined) => event?.sender.id ?? -1;

const ready = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BUBBLE_READY_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.bubble.ready")(function* (_input, event) {
    yield* (yield* DesktopBubble.DesktopBubble).ready(senderId(event));
  }),
});

const resize = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BUBBLE_RESIZE_CHANNEL,
  payload: DesktopBubbleSizeSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.bubble.resize")(function* (size, event) {
    yield* (yield* DesktopBubble.DesktopBubble).resize(senderId(event), size);
  }),
});

const setInteractive = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BUBBLE_SET_INTERACTIVE_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.bubble.setInteractive")(function* (interactive, event) {
    yield* (yield* DesktopBubble.DesktopBubble).setInteractive(senderId(event), interactive);
  }),
});

const dragStart = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BUBBLE_DRAG_START_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.bubble.dragStart")(function* (_input, event) {
    yield* (yield* DesktopBubble.DesktopBubble).dragStart(senderId(event));
  }),
});

// Pointer moves arrive at frame rate; a span each would flood traces.
const dragMove = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BUBBLE_DRAG_MOVE_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Void,
  handler: Effect.fnUntraced(function* (_input, event) {
    yield* (yield* DesktopBubble.DesktopBubble).dragMove(senderId(event));
  }),
});

const dragEnd = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BUBBLE_DRAG_END_CHANNEL,
  payload: Schema.Struct({ animate: Schema.Boolean }),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.bubble.dragEnd")(function* (options, event) {
    yield* (yield* DesktopBubble.DesktopBubble).dragEnd(senderId(event), options);
  }),
});

const openThread = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BUBBLE_OPEN_THREAD_CHANNEL,
  payload: DesktopBubbleThreadTargetSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.bubble.openThread")(function* (target, event) {
    yield* (yield* DesktopBubble.DesktopBubble).openThread(senderId(event), target);
  }),
});

const restoreApp = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.BUBBLE_RESTORE_APP_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.bubble.restoreApp")(function* (_input, event) {
    yield* (yield* DesktopBubble.DesktopBubble).restoreApp(senderId(event));
  }),
});

export const methods = [
  ready,
  resize,
  setInteractive,
  dragStart,
  dragMove,
  dragEnd,
  openThread,
  restoreApp,
] as const;
