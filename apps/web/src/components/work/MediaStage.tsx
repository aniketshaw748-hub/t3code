import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

/**
 * The ground directly behind a video, slide or frame. It stays the same near-black in every
 * theme, so the work's own colours are judged against one background.
 */
export function MediaStage({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="media-stage"
      className={cn("relative overflow-hidden rounded-lg bg-media-stage", className)}
      {...props}
    />
  );
}

/**
 * The focus and selection ring of a control whose face is a stage. The stage paints over its
 * parent's own outline, so the ring is drawn last, inside it; the control carries `group`.
 */
export function MediaStageRing({ selected = false }: { readonly selected?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit] group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-inset",
        selected && "ring-2 ring-primary ring-inset",
      )}
    />
  );
}

/** A small label laid over the media, legible on any frame. */
export function MediaStageChip({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-sm bg-black/70 px-1.5 text-2xs font-medium text-white",
        className,
      )}
      {...props}
    />
  );
}
