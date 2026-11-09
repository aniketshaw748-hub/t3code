import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  resolveDesktopPairingUrl,
  resolveHostedPairingUrl,
  resolveMobileAppPairingUrl,
} from "./pairingUrls";

describe("settings pairing URL helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses direct backend pairing URLs for HTTP endpoints", () => {
    expect(resolveHostedPairingUrl("http://192.168.1.44:3773", "PAIRCODE")).toBeNull();
    expect(resolveDesktopPairingUrl("http://192.168.1.44:3773", "PAIRCODE")).toBe(
      "http://192.168.1.44:3773/pair#token=PAIRCODE",
    );
  });

  it("wraps a tailnet pairing URL in the phone app's pair link", () => {
    expect(
      resolveMobileAppPairingUrl(
        resolveDesktopPairingUrl("http://100.101.102.103:3773", "PAIRCODE"),
      ),
    ).toBe(
      "kavyaan://pair?pairingUrl=http%3A%2F%2F100.101.102.103%3A3773%2Fpair%23token%3DPAIRCODE",
    );
  });

  it("uses hosted pairing URLs for HTTPS endpoints", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://preview.t3.codes");

    expect(resolveHostedPairingUrl("https://host.tailnet.example.ts.net:3773", "PAIRCODE")).toBe(
      "https://preview.t3.codes/pair?host=https%3A%2F%2Fhost.tailnet.example.ts.net%3A3773#token=PAIRCODE",
    );
  });
});
