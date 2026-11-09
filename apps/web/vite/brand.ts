import { BRAND } from "@t3tools/contracts/brand";
import type { Plugin } from "vite-plus";

const MANIFEST_FILE_NAME = "manifest.webmanifest";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const webAppManifest = JSON.stringify(
  {
    id: "/",
    name: BRAND.displayName,
    short_name: BRAND.displayName,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#161616",
    theme_color: "#161616",
    icons: [
      { src: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  },
  null,
  2,
);

/** Fills `{{BRAND_DISPLAY_NAME}}` in index.html and serves the web app manifest from the brand. */
export function brandPlugin(): Plugin {
  return {
    name: "t3code:brand",
    transformIndexHtml: (html) =>
      html.replaceAll("{{BRAND_DISPLAY_NAME}}", escapeHtml(BRAND.displayName)),
    configureServer(server) {
      server.middlewares.use(`/${MANIFEST_FILE_NAME}`, (_request, response) => {
        response.setHeader("Content-Type", "application/manifest+json");
        response.end(webAppManifest);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: MANIFEST_FILE_NAME, source: webAppManifest });
    },
  };
}
