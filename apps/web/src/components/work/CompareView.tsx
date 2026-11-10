import { useAtomValue } from "@effect/atom-react";
import type {
  DeliverableKind,
  DeliverableRegion,
  DeliverableRendition,
  DeliverableVersion,
  EnvironmentId,
} from "@t3tools/contracts";
import {
  changeRegion,
  compareUnitLabel,
  UNIT_CHANGE_LABEL,
} from "@t3tools/client-runtime/work/anchors";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";

import { workEnvironment } from "../../state/work";
import { Badge } from "../ui/badge";
import { InlineButton } from "../ui/button";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { MediaStage } from "./MediaStage";
import { RegionOutline } from "./RegionOutline";
import { useRendition } from "./useWorkData";

type CompareLayout = "side" | "overlay";

/** Two versions side by side or overlaid with a slider, changed slides or shots marked. */
export function CompareView(props: {
  readonly environmentId: EnvironmentId;
  readonly kind: DeliverableKind;
  readonly base: DeliverableVersion;
  readonly target: DeliverableVersion;
  readonly assetUrl: (url: string | null) => string | null;
  readonly onRestoreBase: (() => void) | null;
}) {
  const [layout, setLayout] = useState<CompareLayout>("side");
  const [showUnchanged, setShowUnchanged] = useState(false);
  const comparison = useAtomValue(
    workEnvironment.compare({
      environmentId: props.environmentId,
      input: { baseVersionId: props.base.id, targetVersionId: props.target.id },
    }),
  );
  const baseRendition = useRendition(
    props.environmentId,
    props.base.id,
    props.base.renditionStatus,
  );
  const targetRendition = useRendition(
    props.environmentId,
    props.target.id,
    props.target.renditionStatus,
  );
  const value = AsyncResult.getOrElse(comparison, () => null);
  const changes = value?.units ?? [];
  const shown = showUnchanged ? changes : changes.filter((unit) => unit.status !== "unchanged");
  const image = (rendition: DeliverableRendition | null, index: number | null) => {
    if (index === null || rendition === null) return null;
    const unit = rendition.units.find((candidate) => candidate.index === index);
    return props.assetUrl(unit?.imageUrl ?? unit?.thumbUrl ?? rendition.posterUrl);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-sm font-medium text-foreground">
            V{props.base.ordinal} → V{props.target.ordinal}
            {value === null ? "" : ` · ${value.headline}`}
          </h2>
          {value?.summary ? (
            <p className="max-w-2xl text-sm text-muted-foreground">{value.summary}</p>
          ) : null}
          {AsyncResult.isFailure(comparison) ? (
            <p className="text-sm text-muted-foreground">
              These versions can't be compared until both finish rendering.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            aria-label="Compare layout"
            value={[layout]}
            onValueChange={(next) => {
              if (next[0] === "side" || next[0] === "overlay") setLayout(next[0]);
            }}
          >
            <Toggle value="side">Side by side</Toggle>
            <Toggle value="overlay">Overlay</Toggle>
          </ToggleGroup>
          <ToggleGroup
            aria-label="Which parts"
            value={[showUnchanged ? "all" : "changed"]}
            onValueChange={(next) => setShowUnchanged(next[0] === "all")}
          >
            <Toggle value="changed">Changed</Toggle>
            <Toggle value="all">All</Toggle>
          </ToggleGroup>
        </div>
      </div>
      <ol className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
        {value !== null && shown.length === 0 ? (
          <li className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing visible changed between these versions.
          </li>
        ) : null}
        {shown.map((change) => {
          const before = image(baseRendition, change.baseIndex);
          const after = image(targetRendition, change.targetIndex);
          const region = changeRegion(change);
          return (
            <li key={`${change.baseIndex}:${change.targetIndex}`} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground">
                  {compareUnitLabel(props.kind, change, targetRendition ?? baseRendition)}
                </span>
                <Badge size="sm" variant={change.status === "unchanged" ? "secondary" : "info"}>
                  {UNIT_CHANGE_LABEL[change.status]}
                </Badge>
              </div>
              {layout === "side" ? (
                <div className="grid grid-cols-2 gap-3">
                  <Frame label={`V${props.base.ordinal}`} src={before} region={null} />
                  <Frame label={`V${props.target.ordinal}`} src={after} region={region} />
                </div>
              ) : (
                <OverlayFrame
                  before={before}
                  after={after}
                  beforeLabel={`V${props.base.ordinal}`}
                  afterLabel={`V${props.target.ordinal}`}
                />
              )}
            </li>
          );
        })}
      </ol>
      {props.onRestoreBase === null ? null : (
        <p className="shrink-0 text-xs text-muted-foreground">
          Prefer the earlier one?{" "}
          <InlineButton onClick={props.onRestoreBase}>Restore V{props.base.ordinal}</InlineButton>
        </p>
      )}
    </div>
  );
}

function Frame(props: {
  readonly label: string;
  readonly src: string | null;
  readonly region: DeliverableRegion | null;
}) {
  return (
    <figure className="flex flex-col gap-1">
      <MediaStage className="aspect-video border border-border">
        {props.src === null ? (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-white/60">
            Not in this version
          </span>
        ) : (
          <img src={props.src} alt="" loading="lazy" className="size-full object-contain" />
        )}
        {props.region === null ? null : <RegionOutline region={props.region} />}
      </MediaStage>
      <figcaption className="font-mono text-2xs text-muted-foreground">{props.label}</figcaption>
    </figure>
  );
}

/** One frame over the other; the slider reveals the newer version from the left. */
function OverlayFrame(props: {
  readonly before: string | null;
  readonly after: string | null;
  readonly beforeLabel: string;
  readonly afterLabel: string;
}) {
  const [split, setSplit] = useState(50);
  return (
    <div className="flex flex-col gap-2">
      <MediaStage className="aspect-video border border-border">
        {props.before === null ? null : (
          <img src={props.before} alt="" className="absolute inset-0 size-full object-contain" />
        )}
        {props.after === null ? null : (
          <img
            src={props.after}
            alt=""
            className="absolute inset-0 size-full object-contain"
            style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
          />
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-white/90"
          style={{ left: `${split}%` }}
        />
      </MediaStage>
      <label className="flex items-center gap-2 text-2xs text-muted-foreground">
        <span className="font-mono">{props.afterLabel}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={split}
          aria-label={`Reveal ${props.afterLabel} over ${props.beforeLabel}`}
          onChange={(event) => setSplit(Number(event.currentTarget.value))}
          className="min-w-0 flex-1 accent-primary"
        />
        <span className="font-mono">{props.beforeLabel}</span>
      </label>
    </div>
  );
}
