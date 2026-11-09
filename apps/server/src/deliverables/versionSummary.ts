/** How much of the agent's text a version keeps, so the full wording stays readable. */
const VERSION_SUMMARY_SOURCE_MAX = 4_000;

const SUMMARY_MAX = 200;

// `C:\renders\deck.pptx`, `C:/…`, `/home/me/film.mp4`, `~/out/cut.mov`, `./deck-v2.pptx`, with a
// leading "to"/"at"/… so "Saved it to C:/x.pptx." reads "Saved it."
const FILE_PATH =
  /(?:\s+(?:to|at|in|into|as|under|from)\b)?\s*(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|\/(?=[^\s/]+\/))[^\s)\]"'`]*[^\s)\]"'`.,;:!?]/g;

/** One line of markdown as plain text: links read as their text, marks and paths dropped. */
function plainLine(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<(?:https?|file):[^>]*>/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(FILE_PATH, "")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)+/, "")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?!\w)/g, "$1$2")
    .replace(/`+/g, "")
    .replace(/\*{2,}|(?<=^|\s)[*#>]+(?=\s|$)/g, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first sentence of `text`, kept whole when it runs to a list or a colon. */
function firstSentence(text: string): string {
  const match = /^.+?[.!?](?=\s+["'(]?[A-Z0-9])/.exec(text);
  return (match?.[0] ?? text).replace(/[\s:;,-]+$/, "");
}

/**
 * The one line a version row shows: the agent's first sentence as plain text, without markdown,
 * links or file paths. Null when nothing readable is left.
 */
export function versionSummary(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const lines = text
    .replace(/```[\s\S]*?(?:```|$)/g, "\n")
    .split("\n")
    .map(plainLine)
    .filter((line) => /[\p{L}\p{N}]/u.test(line));
  const first = lines[0];
  if (first === undefined) return null;
  const sentence = firstSentence(first);
  if (sentence.length <= SUMMARY_MAX) return sentence;
  const cut = sentence.slice(0, SUMMARY_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > SUMMARY_MAX / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:-]+$/, "")}…`;
}

/** What the summary column keeps: the source text, trimmed and capped. */
export function versionSummarySource(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? "";
  if (trimmed.length === 0) return null;
  return trimmed.length > VERSION_SUMMARY_SOURCE_MAX
    ? `${trimmed.slice(0, VERSION_SUMMARY_SOURCE_MAX - 1)}…`
    : trimmed;
}
