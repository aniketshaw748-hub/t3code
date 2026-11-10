import { useAtomValue } from "@effect/atom-react";
import { UNIT_CHANGE_LABEL } from "@t3tools/client-runtime/work/anchors";
import type {
  DeliverableAnchor,
  DeliverableKind,
  DeliverableRendition,
  DeliverableSelfCheckResult,
  DeliverableVersion,
  EnvironmentId,
} from "@t3tools/contracts";
import { agentPreviewText } from "@t3tools/shared/agentPreviewText";
import { formatTimecode } from "@t3tools/shared/deliverableNotes";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListRow } from "../../components/ui/ListRow";
import { ListSection } from "../../components/ui/ListSection";
import { workEnvironment } from "../../state/work";
import { WorkLink } from "./WorkLink";

interface WhatChangedProps {
  readonly environmentId: EnvironmentId;
  readonly kind: DeliverableKind;
  readonly version: DeliverableVersion;
  readonly parent: DeliverableVersion | null;
  readonly rendition: DeliverableRendition | null;
  readonly onUnit: (anchor: DeliverableAnchor) => void;
  readonly onCompare: () => void;
}

/** The self-check a version got after rendering: a tick or a warning, and what it found. */
function SelfCheckLine(props: { readonly result: DeliverableSelfCheckResult }) {
  const { result } = props;
  if (result.status === "skipped") return null;
  const passed = result.status === "passed";
  return (
    <View className="flex-row items-start gap-1.5">
      <View className="pt-0.5">
        <SymbolView
          name={passed ? "checkmark.circle" : "exclamationmark.circle"}
          size={13}
          tintColorClassName={
            passed ? "accent-adaptive-emerald-600-400" : "accent-warning-foreground"
          }
          type="monochrome"
        />
      </View>
      <Text className="shrink text-xs text-foreground-muted">
        {passed
          ? "Checked: change landed where you asked"
          : `Check: ${result.findings.length === 0 ? "the change is not where you asked" : result.findings.join(" ")}`}
      </Text>
    </View>
  );
}

/** The version's one-line summary, with the agent's full words a tap away. */
function VersionSummary(props: { readonly version: DeliverableVersion }) {
  const { version } = props;
  const [open, setOpen] = useState(false);
  return (
    <>
      {version.summary ? (
        <Text className="text-sm text-foreground-muted">{version.summary}</Text>
      ) : null}
      {version.summary && version.summaryDetail !== undefined ? (
        <>
          <WorkLink
            label={open ? "Hide what the agent said" : "What the agent said"}
            onPress={() => setOpen((shown) => !shown)}
          />
          {open ? (
            <Text className="text-xs text-foreground-muted">
              {agentPreviewText(version.summaryDetail)}
            </Text>
          ) : null}
        </>
      ) : null}
      {version.selfCheck === null ? null : <SelfCheckLine result={version.selfCheck} />}
    </>
  );
}

/** The viewed version against the one it was made from, in plain words, with each change listed. */
export function WorkWhatChanged(props: WhatChangedProps) {
  if (props.parent === null) {
    return (
      <View className="gap-2">
        <Text className="text-base font-t3-medium">
          V{props.version.ordinal} is the first version
        </Text>
        <VersionSummary version={props.version} />
      </View>
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
    <View className="gap-4">
      <View className="gap-2">
        <Text className="text-base font-t3-medium">
          V{props.parent.ordinal} → V{props.version.ordinal}
          {comparison === null ? "" : ` · ${comparison.headline}`}
        </Text>
        <VersionSummary version={props.version} />
      </View>
      {changed.length > 0 ? (
        <ListSection>
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
              <ListRow
                key={`${unit.baseIndex}:${unit.targetIndex}`}
                label={`${noun} ${index + 1}${at}`}
                detail={UNIT_CHANGE_LABEL[unit.status]}
                onPress={() => props.onUnit(anchor)}
              />
            );
          })}
        </ListSection>
      ) : null}
      <Button
        tone="secondary"
        size="compact"
        icon="square.split.2x1"
        label="Compare the two versions"
        onPress={props.onCompare}
      />
    </View>
  );
}
