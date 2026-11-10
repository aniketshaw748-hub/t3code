import { agentPreviewLines } from "@t3tools/shared/agentPreviewText";

/** How much of the agent's text a version keeps, so the full wording stays readable. */
const VERSION_SUMMARY_SOURCE_MAX = 4_000;

const SUMMARY_MAX = 200;

/** The first sentence of `text`, kept whole when it runs to a list or a colon. */
function firstSentence(text: string): string {
  const match = /^.+?[.!?](?=\s+["'(]?[A-Z0-9])/.exec(text);
  return (match?.[0] ?? text).replace(/[\s:;,-]+$/, "");
}

/**
 * The one line a version row shows: the first sentence of the agent's text as a plain preview,
 * the same reading every other preview of agent text gets. Null when nothing readable is left.
 */
export function versionSummary(text: string | null | undefined): string | null {
  const first = agentPreviewLines(text)[0];
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
