import { BRAND } from "@t3tools/contracts/brand";
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { afterEach, expect, it, vi } from "vite-plus/test";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ APP_VARIANT: process.env.APP_VARIANT }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, BRAND.mobile.appIds.production],
  ["development", BRAND.mobile.appIds.development],
  ["preview", BRAND.mobile.appIds.preview],
  ["production", BRAND.mobile.appIds.production],
])("keeps the iOS and Android identifiers for APP_VARIANT=%j", async (value, identifier) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
  // Copied thread links open this app only while the hosted app's .well-known lists it.
  const host = new URL(DEFAULT_HOSTED_APP_URL).host;
  if (BRAND.mobile.claimsHostedDomains) {
    expect(config.ios?.associatedDomains).toContain(`applinks:${host}`);
    expect(config.android?.intentFilters?.[0]?.data).toEqual([
      { scheme: "https", host, pathPrefix: "/threads/" },
    ]);
  } else {
    expect(config.ios?.associatedDomains).toEqual([]);
    expect(config.android?.intentFilters).toEqual([]);
  }
  expect(config.scheme).toBe(
    BRAND.urlSchemes[(value ?? "production") as keyof typeof BRAND.urlSchemes],
  );
});

it("leaves OTA updates off without the brand's own EAS project", async () => {
  const config = await loadConfig("production");
  expect(config.updates?.enabled).toBe(BRAND.mobile.easProjectId !== undefined);
  if (!BRAND.mobile.easProjectId) expect(config.updates?.url).toBeUndefined();
  expect(config.extra?.androidPushConfigured).toBe(false);
});
