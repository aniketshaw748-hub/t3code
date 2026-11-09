import { BRAND } from "@t3tools/contracts/brand";

const ASSETS = BRAND.assets.directory;

export const BRAND_ASSET_PATHS = {
  developmentIconComposerProject: `${ASSETS}/dev/app-icon.icon`,
  developmentIosIconPng: `${ASSETS}/dev/ios-1024.png`,
  developmentUniversalIconPng: `${ASSETS}/dev/universal-1024.png`,

  productionIconComposerProject: `${ASSETS}/prod/app-icon.icon`,
  productionIosIconPng: `${ASSETS}/prod/ios-1024.png`,
  productionMacIconPng: `${ASSETS}/prod/macos-1024.png`,
  productionLinuxIconPng: `${ASSETS}/prod/universal-1024.png`,
  productionWindowsIconIco: `${ASSETS}/prod/windows.ico`,
  productionWebFaviconIco: `${ASSETS}/prod/web-favicon.ico`,
  productionWebFavicon16Png: `${ASSETS}/prod/web-favicon-16x16.png`,
  productionWebFavicon32Png: `${ASSETS}/prod/web-favicon-32x32.png`,
  productionWebAppleTouchIconPng: `${ASSETS}/prod/web-apple-touch-180.png`,
  productionWebIcon192Png: `${ASSETS}/prod/web-icon-192x192.png`,
  productionWebIcon512Png: `${ASSETS}/prod/web-icon-512x512.png`,

  nightlyIconComposerProject: `${ASSETS}/nightly/app-icon.icon`,
  nightlyIosIconPng: `${ASSETS}/nightly/ios-1024.png`,
  nightlyMacIconPng: `${ASSETS}/nightly/macos-1024.png`,
  nightlyLinuxIconPng: `${ASSETS}/nightly/universal-1024.png`,
  nightlyWindowsIconIco: `${ASSETS}/nightly/windows.ico`,
  nightlyWebFaviconIco: `${ASSETS}/nightly/web-favicon.ico`,
  nightlyWebFavicon16Png: `${ASSETS}/nightly/web-favicon-16x16.png`,
  nightlyWebFavicon32Png: `${ASSETS}/nightly/web-favicon-32x32.png`,
  nightlyWebAppleTouchIconPng: `${ASSETS}/nightly/web-apple-touch-180.png`,
  nightlyWebIcon192Png: `${ASSETS}/nightly/web-icon-192x192.png`,
  nightlyWebIcon512Png: `${ASSETS}/nightly/web-icon-512x512.png`,

  developmentDesktopIconPng: `${ASSETS}/dev/macos-1024.png`,
  developmentWindowsIconIco: `${ASSETS}/dev/windows.ico`,
  developmentWebFaviconIco: `${ASSETS}/dev/web-favicon.ico`,
  developmentWebFavicon16Png: `${ASSETS}/dev/web-favicon-16x16.png`,
  developmentWebFavicon32Png: `${ASSETS}/dev/web-favicon-32x32.png`,
  developmentWebAppleTouchIconPng: `${ASSETS}/dev/web-apple-touch-180.png`,
  developmentWebIcon192Png: `${ASSETS}/dev/web-icon-192x192.png`,
  developmentWebIcon512Png: `${ASSETS}/dev/web-icon-512x512.png`,

  androidForegroundPng: `${ASSETS}/android/foreground.png`,
  androidMonochromePng: `${ASSETS}/android/monochrome.png`,
  androidNotificationPng: `${ASSETS}/android/notification.png`,
  androidDevelopmentSplashPng: `${ASSETS}/android/splash-dev.png`,
  androidNightlySplashPng: `${ASSETS}/android/splash-nightly.png`,
  androidProductionSplashPng: `${ASSETS}/android/splash-prod.png`,
} as const;

export type WebAssetBrand = "development" | "nightly" | "production";

export const WEB_ASSET_CHANNELS = ["latest", "nightly"] as const;

export type WebAssetChannel = (typeof WEB_ASSET_CHANNELS)[number];

export function resolveWebAssetBrandForChannel(channel: WebAssetChannel): WebAssetBrand {
  return channel === "nightly" ? "nightly" : "production";
}

export interface IconOverride {
  readonly sourceRelativePath: string;
  readonly targetRelativePath: string;
}

const WEB_ICON_TARGET_FILENAMES = {
  faviconIco: "favicon.ico",
  favicon16Png: "favicon-16x16.png",
  favicon32Png: "favicon-32x32.png",
  appleTouchIconPng: "apple-touch-icon.png",
  icon192Png: "icon-192x192.png",
  icon512Png: "icon-512x512.png",
} as const;

const WEB_ICON_SOURCE_PATHS_BY_BRAND = {
  development: {
    faviconIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
    icon192Png: BRAND_ASSET_PATHS.developmentWebIcon192Png,
    icon512Png: BRAND_ASSET_PATHS.developmentWebIcon512Png,
  },
  nightly: {
    faviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
    icon192Png: BRAND_ASSET_PATHS.nightlyWebIcon192Png,
    icon512Png: BRAND_ASSET_PATHS.nightlyWebIcon512Png,
  },
  production: {
    faviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
    icon192Png: BRAND_ASSET_PATHS.productionWebIcon192Png,
    icon512Png: BRAND_ASSET_PATHS.productionWebIcon512Png,
  },
} as const satisfies Record<WebAssetBrand, Record<keyof typeof WEB_ICON_TARGET_FILENAMES, string>>;

export function resolveWebIconOverrides(
  brand: WebAssetBrand,
  targetDirectory: string,
): ReadonlyArray<IconOverride> {
  const sourcePaths = WEB_ICON_SOURCE_PATHS_BY_BRAND[brand];
  return [
    {
      sourceRelativePath: sourcePaths.faviconIco,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.faviconIco}`,
    },
    {
      sourceRelativePath: sourcePaths.favicon16Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.favicon16Png}`,
    },
    {
      sourceRelativePath: sourcePaths.favicon32Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.favicon32Png}`,
    },
    {
      sourceRelativePath: sourcePaths.appleTouchIconPng,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.appleTouchIconPng}`,
    },
    {
      sourceRelativePath: sourcePaths.icon192Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.icon192Png}`,
    },
    {
      sourceRelativePath: sourcePaths.icon512Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.icon512Png}`,
    },
  ];
}

export const DEVELOPMENT_ICON_OVERRIDES = resolveWebIconOverrides("development", "dist/client");

export const DEVELOPMENT_PUBLIC_ICON_OVERRIDES = resolveWebIconOverrides(
  "development",
  "apps/web/public",
);
