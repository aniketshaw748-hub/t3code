import { fitContain } from "@t3tools/client-runtime/work/geometry";
import { useState } from "react";

import { observeResize } from "../../lib/observeResize";

/**
 * A ref for a container and the largest box of `aspect` inside it, so overlays drawn over a
 * frame line up with the frame instead of its letterbox.
 */
export function useContainedBox(aspect: number) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [ref] = useState(
    () => (node: HTMLElement | null) =>
      node === null
        ? undefined
        : observeResize(node, (entries) => {
            const rect = entries.at(-1)?.contentRect;
            if (rect !== undefined) setSize({ width: rect.width, height: rect.height });
          }),
  );
  return [ref, size === null ? null : fitContain(size, aspect)] as const;
}
