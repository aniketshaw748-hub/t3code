import { DESKTOP_BUBBLE_DISC_SIZE, type DesktopBubbleSize } from "@t3tools/contracts";

export type BubbleMode = "collapsed" | "list" | "chat";

export const BUBBLE_GAP = 8;
const LIST_WIDTH = 304;
const LIST_ROW_HEIGHT = 52;
const LIST_VISIBLE_ROWS = 5;
const LIST_CHROME_HEIGHT = 48;
/** Room for a hovered row's report: three steps, the current one, and the timing line. */
const LIST_REPORT_HEIGHT = 112;
const CHAT_SIZE = { width: 360, height: 480 };

/**
 * The window size each mode asks for. A list leaves room for one open report; the transparent
 * rest clicks through, so asking for the most it can need avoids resizing on every hover.
 */
export function bubbleWindowSize(mode: BubbleMode, threadCount: number): DesktopBubbleSize {
  if (mode === "collapsed") {
    return { width: DESKTOP_BUBBLE_DISC_SIZE, height: DESKTOP_BUBBLE_DISC_SIZE };
  }
  const panel =
    mode === "chat"
      ? CHAT_SIZE
      : {
          width: LIST_WIDTH,
          height:
            LIST_CHROME_HEIGHT +
            Math.max(1, Math.min(threadCount, LIST_VISIBLE_ROWS)) * LIST_ROW_HEIGHT +
            (threadCount > 0 ? LIST_REPORT_HEIGHT : 0),
        };
  return {
    width: Math.max(DESKTOP_BUBBLE_DISC_SIZE, panel.width),
    height: DESKTOP_BUBBLE_DISC_SIZE + BUBBLE_GAP + panel.height,
  };
}
