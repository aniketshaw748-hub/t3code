/** Markdown reduced to one readable line: no syntax, no code, at most `max` characters. */
export function plainLine(
  markdown: string,
  options: { readonly max: number; readonly pick: "first" | "last" },
): string | null {
  const lines = markdown
    .replace(/```[\s\S]*?(?:```|$)/g, "\n")
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, "")
        .replace(/[*_~`]+/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line.length > 0);
  const line = options.pick === "first" ? lines[0] : lines.at(-1);
  if (line === undefined) return null;
  return line.length > options.max ? `${line.slice(0, options.max - 1).trimEnd()}…` : line;
}
