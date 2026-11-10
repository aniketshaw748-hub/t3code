import type {
  DeliverableAnchor,
  DeliverableKind,
  DeliverableRendition,
  DeliverableVersion,
  DeliverableVersionId,
  EnvironmentId,
} from "@t3tools/contracts";
import { compareUnitPlace, UNIT_CHANGE_LABEL } from "@t3tools/client-runtime/work/anchors";
import { agentPreviewText } from "@t3tools/shared/agentPreviewText";
import { formatTimecode } from "@t3tools/shared/deliverableNotes";
import { ChevronRightIcon, SplitIcon } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { ComparisonNotice } from "./ComparisonNotice";
import { useComparison, useRendition } from "./useWorkData";

interface WhatChangedProps {
  readonly environmentId: EnvironmentId;
  readonly kind: DeliverableKind;
  readonly version: DeliverableVersion;
  readonly parent: DeliverableVersion | null;
  readonly rendition: DeliverableRendition | null;
  /** Opens a changed slide or shot in the version that has it: the older one once removed. */
  readonly onUnit: (place: {
    readonly versionId: DeliverableVersionId;
    readonly anchor: DeliverableAnchor;
  }) => void;
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
  const { result, comparison, retry } = useComparison(
    props.environmentId,
    props.parent,
    props.version,
  );
  const parentRendition = useRendition(
    props.environmentId,
    props.parent.id,
    props.parent.renditionStatus,
  );
  const sides = {
    base: { versionId: props.parent.id, rendition: parentRendition },
    target: { versionId: props.version.id, rendition: props.rendition },
  };
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
        <ComparisonNotice result={result} onRetry={retry} />
      </div>
      {changed.length > 0 ? (
        <ul className="-mx-2 flex flex-col gap-0.5">
          {changed.map((unit) => {
            const place = compareUnitPlace(props.kind, unit, sides);
            const at =
              props.kind === "video" && place.unit?.start !== undefined
                ? ` at ${formatTimecode(place.unit.start)}`
                : "";
            return (
              <li key={`${unit.baseIndex}:${unit.targetIndex}`}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between"
                  onClick={() => props.onUnit(place)}
                >
                  <span className="min-w-0 truncate font-normal">{`${noun} ${place.position}${at}`}</span>
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
