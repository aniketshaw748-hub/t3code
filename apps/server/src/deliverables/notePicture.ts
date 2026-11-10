import type { DeliverableRegion } from "@t3tools/contracts";

/** Width of a note's picture, the same as a rendered slide. */
const WIDTH = 1280;
/** Room kept around a note's area in its close-up, as a fraction of the frame. */
const CLOSE_UP_MARGIN = 0.04;
const OUTLINE = "0xFF3B30";

const within = (value: number) => Math.min(1, Math.max(0, value));
const fraction = (value: number) => value.toFixed(4);

/**
 * The ffmpeg filter graph that turns one frame into a note's picture: the frame at a fixed width,
 * and when the note marks an area, that area outlined on it with a close-up of it underneath.
 */
export function notePictureFilter(region: DeliverableRegion | null): string {
  const frame = `[0:v]scale=${WIDTH}:-2:flags=lanczos`;
  if (region === null) return frame;
  const [left, top] = [within(region.x), within(region.y)];
  const [right, bottom] = [within(region.x + region.w), within(region.y + region.h)];
  if (right <= left || bottom <= top) return frame;
  const closeUp = {
    x: within(left - CLOSE_UP_MARGIN),
    y: within(top - CLOSE_UP_MARGIN),
    right: within(right + CLOSE_UP_MARGIN),
    bottom: within(bottom + CLOSE_UP_MARGIN),
  };
  return [
    `${frame},split[whole][part]`,
    `[whole]drawbox=x=iw*${fraction(left)}:y=ih*${fraction(top)}:w=iw*${fraction(right - left)}:h=ih*${fraction(bottom - top)}:color=${OUTLINE}:t=4[marked]`,
    // Fitted into a frame-sized box and centred under the frame, with a gap between the two.
    `[part]crop=iw*${fraction(closeUp.right - closeUp.x)}:ih*${fraction(closeUp.bottom - closeUp.y)}:iw*${fraction(closeUp.x)}:ih*${fraction(closeUp.y)},scale=${WIDTH}:${Math.round((WIDTH * 9) / 16)}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${WIDTH}:ih+16:(ow-iw)/2:16:color=0x202020[closeup]`,
    "[marked][closeup]vstack",
  ].join(";");
}
