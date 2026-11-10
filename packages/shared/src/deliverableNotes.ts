import type {
  DeliverableAnchor,
  DeliverableKind,
  DeliverableNoteId,
  DeliverableRegion,
} from "@t3tools/contracts";

/** `m:ss`, or `h:mm:ss` past an hour; fractions are dropped. */
export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

function describeRegion(region: DeliverableRegion): string {
  return `the area ${percent(region.x)}-${percent(region.x + region.w)} across, ${percent(region.y)}-${percent(region.y + region.h)} down`;
}

const WHOLE: Record<DeliverableKind, string> = {
  video: "the whole video",
  deck: "the whole deck",
  image: "the whole image",
  pdf: "the whole document",
  other: "the whole file",
};

/** Where a note points, in words an agent and a person both read the same way. */
export function describeAnchor(anchor: DeliverableAnchor | null, kind: DeliverableKind): string {
  if (anchor === null) return WHOLE[kind];
  switch (anchor.kind) {
    case "time": {
      const at =
        anchor.tEnd === undefined
          ? `at ${formatTimecode(anchor.t)}`
          : `from ${formatTimecode(anchor.t)} to ${formatTimecode(anchor.tEnd)}`;
      return anchor.region === undefined ? at : `${at}, ${describeRegion(anchor.region)}`;
    }
    case "slide": {
      const at = `slide ${anchor.index + 1}`;
      return anchor.region === undefined ? at : `${at}, ${describeRegion(anchor.region)}`;
    }
    case "region":
      return describeRegion(anchor);
  }
}

export interface OutgoingNote {
  readonly id: DeliverableNoteId;
  readonly anchor: DeliverableAnchor | null;
  readonly body: string;
  readonly hasSnapshot: boolean;
}

/**
 * The message that sends notes to the agent. Each note keeps its id, so the agent can report
 * back with `deliverable_mark_notes_fixed`; the anchors stay structured in `deliverable_notes`.
 */
export function formatNotesMessage(input: {
  readonly deliverable: {
    readonly title: string;
    readonly path: string;
    readonly kind: DeliverableKind;
  };
  readonly versionOrdinal: number;
  readonly notes: ReadonlyArray<OutgoingNote>;
}): string {
  const { deliverable } = input;
  const lines = input.notes.map((note) => {
    const picture = note.hasSnapshot ? " (a picture of it is attached)" : "";
    return `- [${note.id}] ${describeAnchor(note.anchor, deliverable.kind)}${picture}: ${note.body}`;
  });
  const single = input.notes.length === 1;
  return [
    `${single ? "A note" : "Notes"} on ${deliverable.title === deliverable.path ? deliverable.path : `${deliverable.title} (${deliverable.path})`}, V${input.versionOrdinal}:`,
    ...lines,
    "",
    `When ${single ? "it is" : "they are"} done, call deliverable_mark_notes_fixed with the note ids, a one-line reply, and where to check the change.`,
  ].join("\n");
}

const WHOLE_MESSAGE_HEADER = /^On .+, V\d+, about the whole \w+:\n/;

/**
 * A message about a whole deliverable. It is chat, not a note: nothing to mark fixed, so it
 * names the file and version for the agent and carries no note ids.
 */
export function formatWholeDeliverableMessage(input: {
  readonly deliverable: { readonly path: string; readonly kind: DeliverableKind };
  readonly versionOrdinal: number;
  readonly body: string;
}): string {
  return `On ${input.deliverable.path}, V${input.versionOrdinal}, about ${WHOLE[input.deliverable.kind]}:\n${input.body}`;
}

/** What the user wrote in a whole-deliverable message, without the header the agent reads. */
export function wholeDeliverableMessageBody(text: string): string {
  return text.replace(WHOLE_MESSAGE_HEADER, "");
}
