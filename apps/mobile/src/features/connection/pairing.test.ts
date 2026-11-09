import { BRAND } from "@t3tools/contracts/brand";
import { describe, expect, it } from "vite-plus/test";

import * as NodeModule from "node:module";
import type { getStateFromPath as GetStateFromPath } from "@react-navigation/native";

import {
  buildPairingUrl,
  extractPairingUrlFromQrPayload,
  PAIRING_FORM_LINKING,
  parsePairingUrl,
} from "./pairing";

const requireFromNative = NodeModule.createRequire(
  NodeModule.createRequire(import.meta.url).resolve("@react-navigation/native/package.json"),
);
const { getStateFromPath } = requireFromNative("@react-navigation/core") as {
  readonly getStateFromPath: typeof GetStateFromPath;
};

describe("buildPairingUrl", () => {
  it("uses HTTP for a schemeless IP address", () => {
    expect(buildPairingUrl("192.168.1.100:3773", "pairing-token")).toBe(
      "http://192.168.1.100:3773/#token=pairing-token",
    );
  });

  it("keeps HTTPS as the default for a schemeless hostname", () => {
    expect(buildPairingUrl("remote.example.com", "pairing-token")).toBe(
      "https://remote.example.com/#token=pairing-token",
    );
  });

  it("preserves an explicit scheme for an IP address", () => {
    expect(buildPairingUrl("https://192.168.1.100:3773", "pairing-token")).toBe(
      "https://192.168.1.100:3773/#token=pairing-token",
    );
  });
});

describe("extractPairingUrlFromQrPayload", () => {
  it("unwraps mobile deep links that carry an encoded pairing url", () => {
    expect(
      extractPairingUrlFromQrPayload(
        `${BRAND.urlSchemes.production}://pair?pairingUrl=https%3A%2F%2Fremote.example.com%2Fpair%23token%3Dpairing-token`,
      ),
    ).toBe("https://remote.example.com/pair#token=pairing-token");
  });
});

describe("parsePairingUrl", () => {
  it("reads hosted pairing links into backend host fields", () => {
    expect(
      parsePairingUrl(
        "https://app.t3.codes/pair?host=https%3A%2F%2Fdesktop.tailnet.ts.net%2F#token=pairing-token",
      ),
    ).toEqual({
      host: "https://desktop.tailnet.ts.net",
      code: "pairing-token",
    });
  });
});

describe("pair deep links", () => {
  it("open the prefilled pairing form with the desktop QR's tailnet host and code", () => {
    const link = "pair?pairingUrl=http%3A%2F%2F100.116.182.86%3A3773%2Fpair%23token%3DPAIRCODE";
    const state = getStateFromPath(link, { screens: { ConnectionsNew: PAIRING_FORM_LINKING } });
    const route = state?.routes[0];
    expect(route?.name).toBe("ConnectionsNew");
    const pairingUrl = (route?.params as { pairingUrl?: string } | undefined)?.pairingUrl ?? "";
    expect(parsePairingUrl(pairingUrl)).toEqual({
      host: "http://100.116.182.86:3773",
      code: "PAIRCODE",
    });
  });
});
