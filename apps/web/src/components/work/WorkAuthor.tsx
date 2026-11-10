import { SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";

/** Who wrote something in Work: a person by their initial, the agent by its mark. */
type WorkAuthor = { readonly kind: "person"; readonly name: string } | { readonly kind: "agent" };

export const AGENT_AUTHOR: WorkAuthor = { kind: "agent" };
export const YOU_AUTHOR: WorkAuthor = { kind: "person", name: "You" };

const authorName = (author: WorkAuthor) => (author.kind === "agent" ? "Agent" : author.name);

function AuthorAvatar({ author }: { readonly author: WorkAuthor }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-3xs font-semibold",
        author.kind === "agent" ? "bg-accent text-foreground" : "bg-muted text-muted-foreground",
      )}
    >
      {author.kind === "agent" ? (
        <SparklesIcon className="size-3" />
      ) : (
        author.name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

/** The avatar and name that say who wrote the thing below, with room for a time and a chip. */
export function AuthorLine(props: {
  readonly author: WorkAuthor;
  /** Shown muted after the name, such as when it was written. */
  readonly meta?: ReactNode;
  /** Sits at the end of the line, such as where a note points. */
  readonly trailing?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <AuthorAvatar author={props.author} />
      <span className="min-w-0 truncate text-xs font-medium text-foreground">
        {authorName(props.author)}
      </span>
      {props.meta === undefined ? null : (
        <span className="shrink-0 text-2xs text-muted-foreground">{props.meta}</span>
      )}
      {props.trailing === undefined ? null : (
        <span className="ms-auto flex shrink-0 items-center gap-1.5">{props.trailing}</span>
      )}
    </div>
  );
}
