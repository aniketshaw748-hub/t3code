import type { DeliverableRegion } from "@t3tools/contracts";

/** Where a note points on a frame or slide: a white outline edged in black, to show on any frame. */
export function RegionOutline({ region }: { readonly region: DeliverableRegion }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10 rounded-md bg-white/8 outline-2 outline-white/90 ring-4 ring-black/40 ring-inset"
      style={{
        left: `${region.x * 100}%`,
        top: `${region.y * 100}%`,
        width: `${region.w * 100}%`,
        height: `${region.h * 100}%`,
      }}
    />
  );
}
