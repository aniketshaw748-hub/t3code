import { DesktopT3ImportPreviewSchema, DesktopT3ImportSelectionSchema } from "@t3tools/contracts";
import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopT3Import from "../../settings/DesktopT3Import.ts";
import * as IpcChannels from "../channels.ts";
import { type DesktopIpcInvokeEvent, makeIpcMethod } from "../DesktopIpc.ts";

const senderContents = (event: DesktopIpcInvokeEvent | undefined) =>
  event ? Electron.webContents.fromId(event.sender.id) : undefined;

export const previewT3Import = makeIpcMethod({
  channel: IpcChannels.T3_IMPORT_PREVIEW_CHANNEL,
  payload: Schema.Void,
  result: DesktopT3ImportPreviewSchema,
  handler: Effect.fn("desktop.ipc.t3Import.preview")(function* (_, event) {
    const zoomLevel = senderContents(event)?.getZoomLevel() ?? 0;
    return yield* (yield* DesktopT3Import.DesktopT3Import).preview(zoomLevel);
  }),
});

export const applyT3Import = makeIpcMethod({
  channel: IpcChannels.T3_IMPORT_APPLY_CHANNEL,
  payload: DesktopT3ImportSelectionSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.t3Import.apply")(function* (selection, event) {
    const { zoomLevel } = yield* (yield* DesktopT3Import.DesktopT3Import).apply(selection);
    // Chromium saves a zoom set this way for the app's host, like the zoom menu items do.
    if (zoomLevel !== null) senderContents(event)?.setZoomLevel(zoomLevel);
  }),
});
