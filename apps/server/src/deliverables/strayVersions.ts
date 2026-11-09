// `-v2`, `_ver3`, ` (2)`, `-final`, `_copy 2`: what agents and people add to save a revision.
const VERSION_SUFFIX =
  /(?:[\s._-]*(?:v|ver|version|rev)[\s._-]*\d+|\s*\(\d+\)|[\s._-]+(?:final|new|copy|revised|updated|edited|fixed|latest)(?:[\s._-]*\d+)?)$/i;

interface SplitPath {
  readonly dir: string;
  readonly base: string;
  readonly ext: string;
}

function split(path: string): SplitPath | null {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return {
    dir: path.slice(0, slash + 1),
    base: name.slice(0, dot),
    ext: name.slice(dot + 1).toLowerCase(),
  };
}

/** The name without its version suffixes, lowercased: `Deck-v2 (1)` reads as `deck`. */
function stem(base: string): string {
  let current = base;
  for (;;) {
    const next = current.replace(VERSION_SUFFIX, "");
    if (next === current || next.length === 0) return current.toLowerCase();
    current = next;
  }
}

/**
 * The existing deliverable `path` looks like a revision of: same folder and extension, same name
 * once version suffixes are dropped, and a suffix of its own. Null when none or several match.
 */
export function strayVersionTarget<D extends { readonly path: string }>(
  path: string,
  candidates: ReadonlyArray<D>,
): D | null {
  const stray = split(path);
  if (stray === null || stem(stray.base) === stray.base.toLowerCase()) return null;
  const matches = candidates.filter((candidate) => {
    if (candidate.path === path) return false;
    const other = split(candidate.path);
    return (
      other !== null &&
      other.dir === stray.dir &&
      other.ext === stray.ext &&
      stem(other.base) === stem(stray.base)
    );
  });
  return matches.length === 1 ? matches[0]! : null;
}
