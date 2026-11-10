import { useAtomValue } from "@effect/atom-react";
import type {
  DeliverableAnchor,
  DeliverableKind,
  DeliverableRendition,
  DeliverableVersion,
  EnvironmentId,
} from "@t3tools/contracts";
import { UNIT_CHANGE_LABEL } from "@t3tools/client-runtime/work/anchors";
import { agentPreviewText } from "@t3tools/shared/agentPreviewText";
import { formatTimecode } from "@t3tools/shared/deliverableNotes";
import { AsyncResult } from "effect/reactivity";
import { ChevronRightIcon, SplitIcon } from "lucide-react";

import { workEnvironment } from "../../state/work";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";

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
    return <p className="text-sm text-muted-foreground">{version.summary}</p>;
  }
  return (
    <Collapsible>
      <p className="text-sm text-muted-foreground">{version.summary}</p>
      <CollapsibleTrigger className="group mt-1 inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
        <ChevronRightIcon
          aria-hidden
          className="size-3 transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none"
        />
        What the agent said
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <p className="pt-1 text-xs wrap-anywhere whitespace-pre-line text-muted-foreground">
          {agentPreviewText(version.summaryDetail)}
        </p>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/** The viewed version against the one it was made from, in plain words, with each change listed. */
export function WhatChanged(props: WhatChangedProps) {
  if (props.parent === null) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground">
          V{props.version.ordinal} is the first version
        </h2>
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">
          V{props.parent.ordinal} → V{props.version.ordinal}
          {comparison === null ? "" : ` · ${comparison.headline}`}
        </h2>
        <VersionSummary version={props.version} />
      </div>
      {changed.length > 0 ? (
        <ul className="-mx-2 flex flex-col gap-0.5">
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between"
                  onClick={() => props.onUnit(anchor)}
                >
                  <span className="min-w-0 truncate font-normal">{`${noun} ${index + 1}${at}`}</span>
                  <Badge size="sm" variant="info">
                    {UNIT_CHANGE_LABEL[unit.status]}
                  </Badge>
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
