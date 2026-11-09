/** The route the desktop app's floating bubble window loads; it skips the app shell. */
export const BUBBLE_PAGE_PATH = "/bubble";

/** Read before the router starts: the bubble window runs only the services it needs. */
export function isBubblePage(): boolean {
  return window.location.hash.split("?")[0] === `#${BUBBLE_PAGE_PATH}`;
}
