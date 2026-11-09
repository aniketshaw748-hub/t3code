# Brand icons (Kavyaan, temporary)

`packages/contracts/src/brand.ts` points at this folder through `assets.directory`.

Sources:

- `dev/icon.svg`, `nightly/icon.svg`, `prod/icon.svg`: full-bleed 1024×1024 square icons, one per channel
- `mark.svg`: the glyph alone on a transparent 1024×1024 canvas, for Android's adaptive, monochrome and notification icons

Every PNG and ICO here, and the development web icons copied to `apps/web/public`, are generated.
After changing a source, run `vp run icons:render` (works on Windows, macOS and Linux).

To rebrand, copy this folder, replace the SVGs, point `assets.directory` at the copy, and run the render.
