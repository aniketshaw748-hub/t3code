import { DeliverableNoteId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  describeAnchor,
  formatNotesMessage,
  formatTimecode,
  formatWholeDeliverableMessage,
  wholeDeliverableMessageBody,
} from "./deliverableNotes.ts";

describe("formatTimecode", () => {
  it.each([
    [0, "0:00"],
    [42.9, "0:42"],
    [90, "1:30"],
    [3725, "1:02:05"],
    [-3, "0:00"],
    [Number.NaN, "0:00"],
  ])("formats %s as %s", (seconds, expected) => {
    expect(formatTimecode(seconds)).toBe(expected);
  });
});

describe("describeAnchor", () => {
  it.each([
    [null, "video", "the whole video"],
    [{ kind: "time", t: 42 }, "video", "at 0:42"],
    [{ kind: "time", t: 12, tEnd: 15 }, "video", "from 0:12 to 0:15"],
    [
      { kind: "time", t: 42, region: { x: 0.1, y: 0.2, w: 0.25, h: 0.2 } },
      "video",
      "at 0:42, the area 10%-35% across, 20%-40% down",
    ],
    [{ kind: "slide", index: 2 }, "deck", "slide 3"],
    [null, "deck", "the whole deck"],
  ] as const)("describes %j on a %s", (anchor, kind, expected) => {
    expect(describeAnchor(anchor, kind)).toBe(expected);
  });
});

describe("formatNotesMessage", () => {
  it("keeps each note's id and anchor so the agent can report back", () => {
    const message = formatNotesMessage({
      deliverable: { title: "Launch film", path: "out/launch.mp4", kind: "video" },
      versionOrdinal: 4,
      notes: [
        {
          id: DeliverableNoteId.make("note_a"),
          anchor: { kind: "time", t: 42 },
          body: "Logo lands too late",
          hasSnapshot: true,
        },
        {
          id: DeliverableNoteId.make("note_b"),
          anchor: null,
          body: "Warmer grade",
          hasSnapshot: false,
        },
      ],
    });
    expect(message).toContain("Notes on Launch film (out/launch.mp4), V4:");
    expect(message).toContain(
      "- [note_a] at 0:42 (my drawing on the frame is attached): Logo lands too late",
    );
    expect(message).toContain("- [note_b] the whole video: Warmer grade");
    expect(message).toContain("deliverable_mark_notes_fixed");
  });
});

describe("formatWholeDeliverableMessage", () => {
  it("names the file and version for the agent, and the body comes back out for the chat", () => {
    const message = formatWholeDeliverableMessage({
      deliverable: { path: "decks/pitch.pptx", kind: "deck" },
      versionOrdinal: 2,
      body: "Make it warmer:\nfewer words",
    });
    expect(message).toBe(
      "On decks/pitch.pptx, V2, about the whole deck:\nMake it warmer:\nfewer words",
    );
    expect(message).not.toContain("deliverable_mark_notes_fixed");
    expect(wholeDeliverableMessageBody(message)).toBe("Make it warmer:\nfewer words");
    expect(wholeDeliverableMessageBody("Plain message")).toBe("Plain message");
  });
});
