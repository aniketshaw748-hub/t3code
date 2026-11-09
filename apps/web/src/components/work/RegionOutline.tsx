import type { DeliverableRegion } from "@t3tools/contracts";

/** Where a note points on a frame or slide: a soft white outline over the area. */
export function RegionOutline({ region }: { readonly region: DeliverableRegion }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-10 rounded-md bg-white/8 ring-2 ring-white/90"
      style={{
        left: `${region.x * 100}%`,
        top: `${region.y * 100}%`,
        width: `${region.w * 100}%`,
        height: `${region.h * 100}%`,
      }}
    />
  );
}
