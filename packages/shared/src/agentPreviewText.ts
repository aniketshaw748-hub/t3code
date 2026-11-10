// A path's first step: `C:\`, `C:/`, `~/`, `./`, `../`, or `/dir/` (two segments, so "and/or" stays).
const PATH_START = String.raw`(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|\/(?=[^\s/]+\/))`;
const LINK_TARGET_START = String.raw`(?:${PATH_START}|https?:\/\/|file:)`;

// `[text](target)` and `![alt](target)`. Agents also write `[text] (C:/…)`; a spaced
// parenthesis only counts as a target when it starts like a path or URL.
const LINK = new RegExp(
  String.raw`!?\[([^\]]*)\](?:\([^)]*\)|[ \t]\(${LINK_TARGET_START}[^)]*\))`,
  "g",
);
const REFERENCE_LINK = /\[([^\]]+)\]\[[^\]]*\]/g;
const URL = /<?\b((?:https?:\/\/|file:\/{2,3})[^\s<>)\]"'`]*[^\s<>)\]"'`.,;:!?])>?/g;
const CODE_SPAN = /`+([^`\n]+)`+/g;
const QUOTED_PATH = new RegExp(String.raw`(["'])(${PATH_START}[^"'\n]*)\1`, "g");
const BARE_PATH = new RegExp(
  String.raw`(?<![\w/\\.:~])${PATH_START}[^\s)\]"'\`]*[^\s)\]"'\`.,;:!?]`,
  "g",
);
const STARTS_AS_PATH = new RegExp(`^${PATH_START}`);
// The app's own record ids, such as `note_31e785d4b4c7457ebde861049769d77a`.
const NAMED_RECORD_ID = /\b(note|version|deliverable)\s+[a-z]{2,12}_[0-9a-f]{16,}\b/gi;
const RECORD_ID = /\s*\(?\b[a-z]{2,12}_[0-9a-f]{16,}\b\)?/g;

/** The last step of a path: `C:\renders\film.mp4` and `/home/me/film.mp4` both read `film.mp4`. */
function fileName(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]+/)
      .at(-1) ?? ""
  );
}

function shortUrl(url: string): string {
  if (url.startsWith("file:")) {
    const name = fileName(url);
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  }
  return /^https?:\/\/(?:www\.)?([^/\s:?#]+)/.exec(url)?.[1] ?? "";
}

/** One line of markdown as plain text: links read as their text, paths as their file name. */
function plainLine(line: string): string {
  return line
    .replace(LINK, "$1")
    .replace(REFERENCE_LINK, "$1")
    .replace(URL, (_match, url: string) => shortUrl(url))
    .replace(CODE_SPAN, (_match, code: string) =>
      STARTS_AS_PATH.test(code.trim()) ? fileName(code.trim()) : code,
    )
    .replace(
      QUOTED_PATH,
      (_match, quote: string, path: string) => `${quote}${fileName(path)}${quote}`,
    )
    .replace(BARE_PATH, fileName)
    .replace(NAMED_RECORD_ID, "the $1")
    .replace(RECORD_ID, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)+/, "")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?!\w)/g, "$1$2")
    .replace(/`+/g, "")
    .replace(/\*{2,}|(?<=^|\s)[*#>]+(?=\s|$)/g, "")
    .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
    .replace(/\s*\|\s*/g, " · ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Agent markdown as the plain lines a preview shows: fenced code is left out, links read as
 * their text, absolute paths and URLs shorten to a file or site name, and emphasis, heading,
 * list and code marks are dropped. Lines with nothing readable are skipped.
 */
export function agentPreviewLines(markdown: string | null | undefined): ReadonlyArray<string> {
  if (markdown === null || markdown === undefined) return [];
  return markdown
    .replace(/```[\s\S]*?(?:```|$)/g, "\n")
    .split("\n")
    .map(plainLine)
    .filter((line) => /[\p{L}\p{N}]/u.test(line));
}

/** Agent markdown as plain preview text, one readable line per source line. */
export function agentPreviewText(markdown: string | null | undefined): string {
  return agentPreviewLines(markdown).join("\n");
}
