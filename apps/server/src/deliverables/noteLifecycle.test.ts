import {
  DeliverableId,
  DeliverableNoteId,
  DeliverableVersionId,
  RunId,
  type DeliverableNoteStatus,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { adoptRunNotes, settleRunNotes } from "./noteLifecycle.ts";

const run = RunId.make("run-1");
const otherRun = RunId.make("run-0");
const deck = DeliverableId.make("dlv_deck");
const film = DeliverableId.make("dlv_film");

const note = (
  id: string,
  overrides: {
    readonly deliverableId?: DeliverableId;
    readonly status?: DeliverableNoteStatus;
    readonly sentRunId?: RunId | null;
    readonly addressedRunId?: RunId | null;
    readonly reply?: string | null;
  } = {},
) => ({
  id: DeliverableNoteId.make(id),
  deliverableId: overrides.deliverableId ?? film,
  status: overrides.status ?? "fixing",
  sentRunId: overrides.sentRunId === undefined ? run : overrides.sentRunId,
  addressedRunId: overrides.addressedRunId ?? null,
  reply: overrides.reply ?? null,
  fixedInVersionId: null,
});

const version = (id: string, ordinal: number, deliverableId = film) => ({
  id: DeliverableVersionId.make(id),
  deliverableId,
  ordinal,
  summary: `Summary of ${id}`,
});

describe("settleRunNotes", () => {
  it("fixes addressed notes in the run's newest version as soon as it exists", () => {
    const patches = settleRunNotes({
      notes: [note("a", { addressedRunId: run }), note("b")],
      runId: run,
      runVersions: [version("v4", 4), version("v5", 5)],
      final: false,
    });
    expect(patches).toEqual([{ noteId: "a", status: "fixed", fixedInVersionId: "v5" }]);
  });

  it("falls back to every sent note when the agent marked none, replying with the summary", () => {
    const patches = settleRunNotes({
      notes: [note("a"), note("b", { reply: "Done." })],
      runId: run,
      runVersions: [version("v5", 5)],
      final: true,
    });
    expect(patches).toEqual([
      { noteId: "a", status: "fixed", fixedInVersionId: "v5", reply: "Summary of v5" },
      { noteId: "b", status: "fixed", fixedInVersionId: "v5" },
    ]);
  });

  it("reopens sent notes the agent skipped while marking others, and those with no version", () => {
    const patches = settleRunNotes({
      notes: [
        note("marked", { addressedRunId: run }),
        note("skipped"),
        note("deck-note", { deliverableId: deck }),
      ],
      runId: run,
      runVersions: [version("v5", 5)],
      final: true,
    });
    expect(patches).toEqual([
      { noteId: "marked", status: "fixed", fixedInVersionId: "v5" },
      { noteId: "skipped", status: "open" },
      { noteId: "deck-note", status: "open" },
    ]);
  });

  it("leaves resolved notes and other runs' notes alone", () => {
    const patches = settleRunNotes({
      notes: [
        note("resolved", { status: "resolved", addressedRunId: run }),
        note("other", { sentRunId: otherRun }),
      ],
      runId: run,
      runVersions: [version("v5", 5)],
      final: true,
    });
    expect(patches).toEqual([]);
  });
});

describe("adoptRunNotes", () => {
  it("fixes the run's notes on the original in the adopted version and moves the stray's notes", () => {
    const stray = DeliverableId.make("dlv_stray");
    const patches = adoptRunNotes({
      notes: [
        note("sent", { status: "open" }),
        note("addressed", { addressedRunId: run, sentRunId: null, reply: "Bigger logo." }),
        note("other-run", { status: "open", sentRunId: otherRun }),
        note("resolved", { status: "resolved" }),
        note("on-stray", { deliverableId: stray, status: "open", sentRunId: null }),
        note("other-file", { deliverableId: deck }),
      ],
      runId: run,
      strayDeliverableId: stray,
      version: version("v3", 3),
    });
    expect(patches).toEqual([
      { noteId: "sent", status: "fixed", fixedInVersionId: "v3", reply: "Summary of v3" },
      { noteId: "addressed", status: "fixed", fixedInVersionId: "v3" },
      { noteId: "on-stray", deliverableId: film, versionId: "v3" },
    ]);
  });
});
