import { buildHostedPairingUrl } from "../../hostedPairing";
import { setPairingTokenOnUrl } from "@t3tools/shared/remote";
import { BRAND } from "@t3tools/contracts/brand";

export function resolveDesktopPairingUrl(endpointUrl: string, credential: string): string {
  const url = new URL(endpointUrl);
  url.pathname = "/pair";
  return setPairingTokenOnUrl(url, credential).toString();
}

export function resolveHostedPairingUrl(endpointUrl: string, credential: string): string | null {
  const url = new URL(endpointUrl);
  if (url.protocol !== "https:") {
    return null;
  }

  return buildHostedPairingUrl({
    host: endpointUrl,
    token: credential,
  });
}

/** A link the phone camera hands to the installed app, which pairs over `pairingUrl`. */
export function resolveMobileAppPairingUrl(pairingUrl: string): string {
  return `${BRAND.urlSchemes.production}://pair?pairingUrl=${encodeURIComponent(pairingUrl)}`;
}
