import { useAtomValue } from "@effect/atom-react";
import type {
  DeliverableAnchor,
  DeliverableKind,
  DeliverableRendition,
  DeliverableVersion,
  EnvironmentId,
} from "@t3tools/contracts";
import { formatTimecode } from "@t3tools/shared/deliverableNotes";
import { AsyncResult } from "effect/reactivity";
import { SplitIcon } from "lucide-react";

import { workEnvironment } from "../../state/work";
import { Button } from "../ui/button";

interface WhatChangedProps {
  readonly environmentId: EnvironmentId;
  readonly kind: DeliverableKind;
  readonly version: DeliverableVersion;
  readonly parent: DeliverableVersion | null;
  readonly rendition: DeliverableRendition | null;
  readonly onUnit: (anchor: DeliverableAnchor) => void;
  readonly onCompare: () => void;
}

/** The version's one-line summary, with the agent's full words a click away. */
function VersionSummary({ version }: { readonly version: DeliverableVersion }) {
  if (!version.summary) return null;
  if (version.summaryDetail === undefined) {
    return <p className="text-sm text-work-muted">{version.summary}</p>;
  }
  return (
    <details className="text-sm text-work-muted">
      <summary className="cursor-pointer">{version.summary}</summary>
      <p className="mt-1 text-xs whitespace-pre-line">{version.summaryDetail}</p>
    </details>
  );
}

/** The viewed version against the one it was made from, in plain words, with each change listed. */
export function WhatChanged(props: WhatChangedProps) {
  if (props.parent === null) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-work-ink">
          V{props.version.ordinal} is the first version
        </p>
        <VersionSummary version={props.version} />
      </div>
    );
  }
  return <Comparison {...props} parent={props.parent} />;
}

function Comparison(props: WhatChangedProps & { readonly parent: DeliverableVersion }) {
  const result = useAtomValue(
    workEnvironment.compare({
      environmentId: props.environmentId,
      input: { baseVersionId: props.parent.id, targetVersionId: props.version.id },
    }),
  );
  const comparison = AsyncResult.getOrElse(result, () => null);
  const changed = (comparison?.units ?? []).filter((unit) => unit.status !== "unchanged");
  const noun = props.kind === "video" ? "Shot" : props.kind === "pdf" ? "Page" : "Slide";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-work-ink">
          V{props.parent.ordinal} → V{props.version.ordinal}
          {comparison === null ? "" : ` · ${comparison.headline}`}
        </p>
        <VersionSummary version={props.version} />
      </div>
      {changed.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {changed.map((unit) => {
            const index = unit.targetIndex ?? unit.baseIndex ?? 0;
            const shot = props.rendition?.units.find((candidate) => candidate.index === index);
            const anchor: DeliverableAnchor =
              props.kind === "video"
                ? { kind: "time", t: shot?.start ?? 0 }
                : { kind: "slide", index };
            const at =
              props.kind === "video" && shot?.start !== undefined
                ? ` at ${formatTimecode(shot.start)}`
                : "";
            return (
              <li key={`${unit.baseIndex}:${unit.targetIndex}`}>
                <Button variant="ghost" size="xs" onClick={() => props.onUnit(anchor)}>
                  {`${noun} ${index + 1}${at}: ${unit.status}`}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div>
        <Button variant="outline" size="xs" onClick={props.onCompare}>
          <SplitIcon />
          Compare side by side
        </Button>
      </div>
    </div>
  );
}
