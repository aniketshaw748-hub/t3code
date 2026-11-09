/** `id` is the block's position, which stays put as a streaming reply grows. */
export type CompactReplyBlock =
  | { readonly kind: "text"; readonly id: string; readonly markdown: string }
  | {
      readonly kind: "code";
      readonly id: string;
      readonly language: string | null;
      readonly code: string;
      readonly lineCount: number;
    };

export interface CompactReply {
  readonly blocks: ReadonlyArray<CompactReplyBlock>;
  /** Text past the budget was left out; the full thread has it. */
  readonly truncated: boolean;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^\n]*$/;

function splitFences(markdown: string): CompactReplyBlock[] {
  const blocks: CompactReplyBlock[] = [];
  let text: string[] = [];
  let code: { fence: string; language: string | null; lines: string[] } | null = null;
  const flushText = () => {
    const markdownText = text.join("\n").trim();
    if (markdownText.length > 0) {
      blocks.push({ kind: "text", id: `block-${blocks.length}`, markdown: markdownText });
    }
    text = [];
  };
  const flushCode = () => {
    if (code === null) return;
    const body = code.lines.join("\n").replace(/\n+$/, "");
    if (body.trim().length > 0) {
      blocks.push({
        kind: "code",
        id: `block-${blocks.length}`,
        language: code.language,
        code: body,
        lineCount: body.split("\n").length,
      });
    }
    code = null;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const fence = FENCE.exec(line);
    if (code === null) {
      if (fence?.[1] !== undefined) {
        flushText();
        code = { fence: fence[1], language: fence[2] || null, lines: [] };
      } else {
        text.push(line);
      }
      continue;
    }
    const closing = fence?.[1];
    if (
      closing !== undefined &&
      closing[0] === code.fence[0] &&
      closing.length >= code.fence.length &&
      fence?.[2] === ""
    ) {
      flushCode();
    } else {
      code.lines.push(line);
    }
  }
  // A fence still open while the reply streams holds code so far.
  flushCode();
  flushText();
  return blocks;
}

function cutText(markdown: string, budget: number): string {
  const paragraphEnd = markdown.lastIndexOf("\n\n", budget);
  if (paragraphEnd > budget / 2) return markdown.slice(0, paragraphEnd).trimEnd();
  const sentenceEnd = markdown.slice(0, budget).search(/[.!?](?=\s)[^.!?]*$/);
  if (sentenceEnd > budget / 2) return markdown.slice(0, sentenceEnd + 1);
  return `${markdown.slice(0, budget).trimEnd()}…`;
}

/**
 * A reply for a small window: code blocks become collapsible blocks that cost no text budget, and
 * prose stops near `maxTextChars` at a paragraph or sentence end.
 */
export function buildCompactReply(markdown: string, maxTextChars: number): CompactReply {
  const blocks: CompactReplyBlock[] = [];
  let remaining = maxTextChars;
  for (const block of splitFences(markdown)) {
    if (block.kind === "code") {
      blocks.push(block);
      continue;
    }
    if (block.markdown.length <= remaining) {
      blocks.push(block);
      remaining -= block.markdown.length;
      continue;
    }
    if (remaining > 0) blocks.push({ ...block, markdown: cutText(block.markdown, remaining) });
    return { blocks, truncated: true };
  }
  return { blocks, truncated: false };
}
