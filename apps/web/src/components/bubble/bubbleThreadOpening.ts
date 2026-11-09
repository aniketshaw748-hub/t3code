import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { AnyRouter } from "@tanstack/react-router";

import { buildThreadRouteParams } from "../../threadRoutes";

/** Opens the thread the floating bubble asks for; the main process brings the window forward. */
export function startBubbleThreadOpening(router: AnyRouter): () => void {
  return (
    window.desktopBridge?.onBubbleOpenThread((target) => {
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(target.environmentId, target.threadId)),
      });
    }) ?? (() => {})
  );
}
