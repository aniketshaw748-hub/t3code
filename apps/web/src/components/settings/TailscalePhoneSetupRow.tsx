import { BRAND } from "@t3tools/contracts/brand";
import {
  AuthStandardClientScopes,
  type AdvertisedEndpoint,
  type DesktopTailscaleAvailability,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useState } from "react";

import { authEnvironment } from "~/state/auth";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { QRCodeSvg } from "../ui/qr-code";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { tailscalePhoneStep } from "./ConnectionsSettings.logic";
import { resolveDesktopPairingUrl, resolveMobileAppPairingUrl } from "./pairingUrls";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const STEP_TEXT = {
  install:
    "Install Tailscale on this computer and on your phone (tailscale.com/download), and sign in to the same account on both.",
  start: "Tailscale is installed but not running. Start it on this computer.",
  "sign-in": "Sign in to Tailscale on this computer.",
} as const;

/**
 * Desktop-only guide from "is Tailscale here?" to a QR the phone app scans. It checks the CLI
 * only when asked, since spawning it can raise a permission prompt on macOS.
 */
export function TailscalePhoneSetupRow({
  environmentId,
  endpoints,
  busy,
  onAllowNetworkAccess,
  onServeHttps,
}: {
  readonly environmentId: EnvironmentId;
  readonly endpoints: ReadonlyArray<AdvertisedEndpoint>;
  readonly busy: boolean;
  readonly onAllowNetworkAccess: () => void;
  readonly onServeHttps: () => void;
}) {
  const [availability, setAvailability] = useState<DesktopTailscaleAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const [qr, setQr] = useState<{ readonly url: string; readonly endpoint: string } | null>(null);
  const createPairingCredential = useAtomCommand(authEnvironment.createPairingCredential, {
    reportFailure: false,
  });
  const bridge = window.desktopBridge;
  if (!bridge) return null;

  const check = async () => {
    setChecking(true);
    // A failed read keeps what was last known.
    const next = await bridge.getTailscaleAvailability().catch(() => null);
    setChecking(false);
    if (next !== null) setAvailability(next);
  };

  const step = availability ? tailscalePhoneStep(availability, endpoints) : null;
  const showQr = async (endpoint: AdvertisedEndpoint) => {
    const result = await createPairingCredential({
      environmentId,
      input: { label: "Phone over Tailscale", scopes: [...AuthStandardClientScopes] },
    });
    if (result._tag !== "Success") {
      toastManager.add(
        stackedThreadToast({ type: "error", title: "Could not create a pairing link" }),
      );
      return;
    }
    setQr({
      url: resolveMobileAppPairingUrl(
        resolveDesktopPairingUrl(endpoint.httpBaseUrl, result.value.credential),
      ),
      endpoint: endpoint.httpBaseUrl,
    });
  };

  const description =
    step === null
      ? `Reach this computer from the ${BRAND.displayName} phone app anywhere, through your private Tailscale network.`
      : step.kind === "ready"
        ? `Phones on your tailnet reach this computer at ${step.endpoint.httpBaseUrl}.`
        : step.kind === "expose"
          ? availability?.state === "running" && availability.magicDnsName
            ? `Tailscale is connected as ${availability.magicDnsName}. Let tailnet devices reach ${BRAND.displayName}: serve it over HTTPS, or turn on network access to use the Tailscale IP.`
            : "Tailscale is connected. Serve this backend on the tailnet, or turn on network access."
          : STEP_TEXT[step.kind];

  return (
    <SettingsRow
      {...searchableSetting("tailscale-phone")}
      title="Phone over Tailscale"
      description={description}
      control={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {step?.kind === "expose" ? (
            <>
              {step.httpsServeEnabled !== false ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={onServeHttps}>
                  Serve over HTTPS
                </Button>
              ) : null}
              <Button size="sm" variant="outline" disabled={busy} onClick={onAllowNetworkAccess}>
                Use Tailscale IP
              </Button>
            </>
          ) : null}
          {step?.kind === "ready" ? (
            <Button size="sm" disabled={busy} onClick={() => void showQr(step.endpoint)}>
              {qr ? "New pairing QR" : "Show pairing QR"}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={checking} onClick={() => void check()}>
            {checking ? "Checking…" : availability ? "Check again" : "Check Tailscale"}
          </Button>
        </div>
      }
    >
      {qr && step?.kind === "ready" ? (
        <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:items-start">
          <div className="rounded-xl bg-white p-3">
            <QRCodeSvg
              value={qr.url}
              size={168}
              level="M"
              marginSize={1}
              title={`Scan with your phone camera to pair the ${BRAND.displayName} app`}
            />
          </div>
          <p className="max-w-xs text-xs text-muted-foreground">
            Scan with the phone camera, or from {BRAND.displayName} → Settings → Environments → Add.
            The phone must be signed in to Tailscale too. The link works once and pairs over{" "}
            {qr.endpoint}.
          </p>
        </div>
      ) : null}
    </SettingsRow>
  );
}
