#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - A one-shot asset renderer with no Effect runtime.
// Renders every tracked icon from the brand's SVG sources with sharp, so it runs on any OS.
// Sources: <assets>/<dev|nightly|prod>/icon.svg (full-bleed square) and <assets>/mark.svg
// (the glyph alone, on a transparent canvas, for Android's adaptive and monochrome layers).
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { BRAND } from "@t3tools/contracts/brand";
import sharp from "sharp";

import { BRAND_ASSET_PATHS, DEVELOPMENT_PUBLIC_ICON_OVERRIDES } from "./lib/brand-assets.ts";
import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

const REPO_ROOT = NodePath.resolve(import.meta.dirname, "..");
const CANVAS = 1024;
// Matches the macOS pre-Tahoe safe area: an 824px body inset 100px.
const MAC_BODY = 824;
const CORNER_RATIO = 0.225;
const ANDROID_ADAPTIVE_CANVAS = 432;
const ANDROID_SPLASH_CANVAS = 1152;
const ANDROID_NOTIFICATION_CANVAS = 96;
// A status bar icon is drawn 24dp square; its glyph fills that but for a 2dp margin each side.
const ANDROID_NOTIFICATION_GLYPH_FRACTION = 20 / 24;
// Android masks the central 72dp of a 108dp layer; keep the glyph well inside it.
const ANDROID_GLYPH_FRACTION = 1;

const repoPath = (relativePath: string) => NodePath.join(REPO_ROOT, ...relativePath.split("/"));

const readSvg = (relativePath: string) => NodeFSP.readFile(repoPath(relativePath));

const roundedMask = (size: number) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${size * CORNER_RATIO}" fill="#fff"/></svg>`,
  );

const renderSquare = (svg: Buffer, size: number) =>
  sharp(svg, { density: 300 }).resize(size, size).png().toBuffer();

const renderRounded = async (svg: Buffer, size: number) =>
  sharp(await renderSquare(svg, size))
    .composite([{ input: roundedMask(size), blend: "dest-in" }])
    .png()
    .toBuffer();

/** A rounded body of `bodySize` centred on a transparent `canvas`. */
const renderInset = async (svg: Buffer, canvas: number, bodySize: number) =>
  sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: await renderRounded(svg, bodySize), gravity: "center" }])
    .png()
    .toBuffer();

const writeAsset = async (relativePath: string, contents: Buffer) => {
  await NodeFSP.mkdir(NodePath.dirname(repoPath(relativePath)), { recursive: true });
  await NodeFSP.writeFile(repoPath(relativePath), contents);
};

const CHANNELS = [
  {
    folder: "dev",
    ios: BRAND_ASSET_PATHS.developmentIosIconPng,
    mac: BRAND_ASSET_PATHS.developmentDesktopIconPng,
    universal: BRAND_ASSET_PATHS.developmentUniversalIconPng,
    windowsIco: BRAND_ASSET_PATHS.developmentWindowsIconIco,
    faviconIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    favicon16: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    appleTouch: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
    web192: BRAND_ASSET_PATHS.developmentWebIcon192Png,
    web512: BRAND_ASSET_PATHS.developmentWebIcon512Png,
    androidSplash: BRAND_ASSET_PATHS.androidDevelopmentSplashPng,
  },
  {
    folder: "nightly",
    ios: BRAND_ASSET_PATHS.nightlyIosIconPng,
    mac: BRAND_ASSET_PATHS.nightlyMacIconPng,
    universal: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
    windowsIco: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
    faviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
    favicon16: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
    appleTouch: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
    web192: BRAND_ASSET_PATHS.nightlyWebIcon192Png,
    web512: BRAND_ASSET_PATHS.nightlyWebIcon512Png,
    androidSplash: BRAND_ASSET_PATHS.androidNightlySplashPng,
  },
  {
    folder: "prod",
    ios: BRAND_ASSET_PATHS.productionIosIconPng,
    mac: BRAND_ASSET_PATHS.productionMacIconPng,
    universal: BRAND_ASSET_PATHS.productionLinuxIconPng,
    windowsIco: BRAND_ASSET_PATHS.productionWindowsIconIco,
    faviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
    favicon16: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    appleTouch: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
    web192: BRAND_ASSET_PATHS.productionWebIcon192Png,
    web512: BRAND_ASSET_PATHS.productionWebIcon512Png,
    androidSplash: BRAND_ASSET_PATHS.androidProductionSplashPng,
  },
] as const;

const icoFrom = async (svg: Buffer, sizes: ReadonlyArray<number>) =>
  encodePngIco(
    await Promise.all(
      sizes.map(async (size) => ({ size, contents: await renderRounded(svg, size) })),
    ),
  );

for (const channel of CHANNELS) {
  const svg = await readSvg(`${BRAND.assets.directory}/${channel.folder}/icon.svg`);
  // iOS and the Apple touch icon apply their own mask, so they stay full bleed.
  await writeAsset(channel.ios, await renderSquare(svg, CANVAS));
  await writeAsset(channel.appleTouch, await renderSquare(svg, 180));
  await writeAsset(channel.mac, await renderInset(svg, CANVAS, MAC_BODY));
  await writeAsset(channel.universal, await renderRounded(svg, CANVAS));
  await writeAsset(channel.web192, await renderRounded(svg, 192));
  await writeAsset(channel.web512, await renderRounded(svg, 512));
  await writeAsset(channel.favicon16, await renderRounded(svg, 16));
  await writeAsset(channel.favicon32, await renderRounded(svg, 32));
  await writeAsset(channel.windowsIco, await icoFrom(svg, WINDOWS_ICON_SIZES));
  await writeAsset(channel.faviconIco, await icoFrom(svg, [16, 32, 48]));
  // The Android 12+ splash masks the central two thirds of its canvas.
  await writeAsset(
    channel.androidSplash,
    await renderInset(svg, ANDROID_SPLASH_CANVAS, Math.round((ANDROID_SPLASH_CANVAS * 2) / 3)),
  );
}

const mark = await readSvg(`${BRAND.assets.directory}/mark.svg`);
const centredMark = async (canvas: number, fraction: number) =>
  sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: await renderSquare(mark, Math.round(canvas * fraction)), gravity: "center" },
    ])
    .png()
    .toBuffer();
/** The glyph without the empty canvas around it, as large as fits `fraction` of `canvas`. */
const tightMark = async (canvas: number, fraction: number) => {
  const size = Math.round(canvas * fraction);
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  const glyph = await sharp(await renderSquare(mark, CANVAS))
    .trim()
    .resize(size, size, { fit: "contain", background: transparent })
    .png()
    .toBuffer();
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: transparent } })
    .composite([{ input: glyph, gravity: "center" }])
    .png()
    .toBuffer();
};
const androidGlyph = await centredMark(ANDROID_ADAPTIVE_CANVAS, ANDROID_GLYPH_FRACTION);
await writeAsset(BRAND_ASSET_PATHS.androidForegroundPng, androidGlyph);
await writeAsset(BRAND_ASSET_PATHS.androidMonochromePng, androidGlyph);
// Other apps' status bar icons fill their box, so this one drops the mark's own canvas margin.
await writeAsset(
  BRAND_ASSET_PATHS.androidNotificationPng,
  await tightMark(ANDROID_NOTIFICATION_CANVAS, ANDROID_NOTIFICATION_GLYPH_FRACTION),
);

for (const override of DEVELOPMENT_PUBLIC_ICON_OVERRIDES) {
  await writeAsset(
    override.targetRelativePath,
    await NodeFSP.readFile(repoPath(override.sourceRelativePath)),
  );
}
