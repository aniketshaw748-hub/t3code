import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { isBubblePage } from "./bubblePage";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";

// Keep webviews outside the router but inside its atom registry so route changes preserve them.
export function AppRoot({ router }: { readonly router: AppRouter }) {
  return (
    <AppAtomRegistryProvider>
      <RouterProvider router={router} />
      {/* The bubble window must not host previews; the main window already does. */}
      {isBubblePage() ? null : (
        <>
          <ElectronBrowserHost />
          <QuitHoldOverlay />
        </>
      )}
    </AppAtomRegistryProvider>
  );
}
