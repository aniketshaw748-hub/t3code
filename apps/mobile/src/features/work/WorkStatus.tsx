import type { ShelfStatusKind } from "@t3tools/client-runtime/work/shelf";
import type { DeliverableNoteStatus } from "@t3tools/contracts";
import { View } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

/**
 * How a status reads in Work: an icon and its words in one colour, the way the thread list shows
 * a thread's status. The colours are the same ones, so "working" or "needs you" look alike
 * wherever they appear.
 */
type StatusTone = "attention" | "input" | "working" | "review" | "done" | "failed" | "quiet";

const TONE: Record<
  StatusTone,
  { readonly text: string; readonly tint: string; readonly fill: string }
> = {
  attention: {
    text: "text-adaptive-amber-700-300",
    tint: "accent-adaptive-amber-700-300",
    fill: "bg-adaptive-amber-700-300",
  },
  input: {
    text: "text-adaptive-indigo-600-300",
    tint: "accent-adaptive-indigo-600-300",
    fill: "bg-adaptive-indigo-600-300",
  },
  working: {
    text: "text-adaptive-sky-600-400",
    tint: "accent-adaptive-sky-600-400",
    fill: "bg-adaptive-sky-600-400",
  },
  review: {
    text: "text-adaptive-violet-600-400",
    tint: "accent-adaptive-violet-600-400",
    fill: "bg-adaptive-violet-600-400",
  },
  done: {
    text: "text-adaptive-emerald-600-400",
    tint: "accent-adaptive-emerald-600-400",
    fill: "bg-adaptive-emerald-600-400",
  },
  failed: {
    text: "text-danger-foreground",
    tint: "accent-danger-foreground",
    fill: "bg-danger-foreground",
  },
  quiet: {
    text: "text-foreground-muted",
    tint: "accent-foreground-muted",
    fill: "bg-foreground-muted",
  },
};

interface StatusLook {
  readonly tone: StatusTone;
  readonly icon: AppSymbolName;
}

const NOTE_LOOK: Record<DeliverableNoteStatus, StatusLook> = {
  open: { tone: "attention", icon: "circle" },
  fixing: { tone: "working", icon: "circle.dashed" },
  fixed: { tone: "review", icon: "eye" },
  resolved: { tone: "done", icon: "checkmark.circle" },
};

const SHELF_LOOK: Record<ShelfStatusKind, StatusLook> = {
  waiting: { tone: "input", icon: "questionmark.bubble" },
  rendering: { tone: "working", icon: "circle.dashed" },
  working: { tone: "working", icon: "circle.dashed" },
  failed: { tone: "failed", icon: "exclamationmark.circle" },
  "notes-back": { tone: "attention", icon: "text.bubble" },
  "in-review": { tone: "review", icon: "eye" },
  final: { tone: "done", icon: "checkmark.circle" },
  "notes-open": { tone: "attention", icon: "circle" },
  "notes-fixing": { tone: "working", icon: "circle.dashed" },
  "notes-fixed": { tone: "review", icon: "eye" },
  resolved: { tone: "done", icon: "checkmark.circle" },
  ready: { tone: "quiet", icon: "play" },
  empty: { tone: "quiet", icon: "circle" },
};

/** The fill a note status uses for its marker on a rail and its segment of the summary bar. */
export const noteStatusFillClassName = (status: DeliverableNoteStatus) =>
  TONE[NOTE_LOOK[status].tone].fill;

function StatusLabel(props: StatusLook & { readonly label: string; readonly lines?: number }) {
  const tone = TONE[props.tone];
  return (
    <View className="min-w-0 shrink flex-row items-start gap-1">
      {/* As tall as one line of the label, so the icon sits on its first line. */}
      <View className="h-[17px] justify-center">
        <SymbolView
          name={props.icon}
          size={13}
          tintColorClassName={tone.tint}
          type="monochrome"
          weight="semibold"
        />
      </View>
      <Text
        numberOfLines={props.lines ?? 1}
        className={cn("shrink text-xs font-t3-bold", tone.text)}
      >
        {props.label}
      </Text>
    </View>
  );
}

/** A note's status in words: `Open`, `Agent fixing`, `Fixed in V4`, `Resolved`. */
export function NoteStatusLabel(props: {
  readonly status: DeliverableNoteStatus;
  readonly label: string;
}) {
  return <StatusLabel {...NOTE_LOOK[props.status]} label={props.label} />;
}

/** A Work project's status in words: `Agent working`, `2 notes open`, `All notes resolved`. */
export function ShelfStatusLabel(props: {
  readonly kind: ShelfStatusKind;
  readonly label: string;
  /** How many lines the words may take before they are cut short. */
  readonly lines?: number;
}) {
  return <StatusLabel {...SHELF_LOOK[props.kind]} label={props.label} lines={props.lines} />;
}
