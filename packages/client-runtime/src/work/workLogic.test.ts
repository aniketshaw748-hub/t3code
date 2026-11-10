import {
  DeliverableId,
  DeliverableNoteId,
  DeliverableVersionId,
  MessageId,
  RunId,
  type DeliverableNote,
  type DeliverableNoteStatus,
  type DeliverableVersion,
  type WorkProjectSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { defaultCompareSelection, orderedCompare, pickCompareVersion } from "./workCompare.ts";
import { layoutNoteMarkers } from "./workMarkers.ts";
import {
  agentProgress,
  checkLinkLabel,
  noteDisplay,
  notesSummary,
  sortNotes,
  workChatEntries,
} from "./workNotes.ts";
import { notesFromFailedRun, shelfStatus, workRunFailure } from "./workShelf.ts";
import { historyAvailability, versionStrip } from "./workVersions.ts";

const v = (ordinal: number, parent: number | null): DeliverableVersion => ({
  id: DeliverableVersionId.make(`v${ordinal}`),
  deliverableId: DeliverableId.make("dlv"),
  ordinal,
  parentVersionId: parent === null ? null : DeliverableVersionId.make(`v${parent}`),
  contentSha256: `sha${ordinal}`,
  sizeBytes: 1,
  commitOid: `c${ordinal}`,
  ref: `r${ordinal}`,
  source: { type: "explicit" },
  summary: `Summary ${ordinal}`,
  expectedChanges: [],
  renditionStatus: "ready",
  selfCheck: null,
  createdAt: DateTime.makeUnsafe(ordinal * 1000),
});
const id = (ordinal: number) => DeliverableVersionId.make(`v${ordinal}`);

const note = (
  name: string,
  status: DeliverableNoteStatus,
  anchor: DeliverableNote["anchor"],
  createdAt = 0,
) => ({
  id: DeliverableNoteId.make(name),
  status,
  anchor,
  createdAt: DateTime.makeUnsafe(createdAt),
});

describe("noteDisplay", () => {
  const ordinalOf = (versionId: string) => (versionId === "v4" ? 4 : undefined);
  it.each([
    [{ status: "open", sentRunId: null }, "Open"],
    [{ status: "fixing", sentRunId: null }, "Sent to agent"],
    [{ status: "fixing", sentRunId: RunId.make("run") }, "Agent fixing"],
    [{ status: "resolved", sentRunId: null }, "Resolved"],
  ] as const)("labels %j as %s", (fields, label) => {
    expect(
      noteDisplay({ ...fields, fixedInVersionId: null, checkAnchor: null, anchor: null }, ordinalOf)
        .label,
    ).toBe(label);
  });

  it("points a fixed note at its version and where the agent said to look", () => {
    const display = noteDisplay(
      {
        status: "fixed",
        sentRunId: RunId.make("run"),
        fixedInVersionId: id(4),
        checkAnchor: { kind: "time", t: 12.4 },
        anchor: { kind: "time", t: 42 },
      },
      ordinalOf,
    );
    expect(display.label).toBe("Fixed in V4");
    expect(display.check).toEqual({
      versionId: "v4",
      versionOrdinal: 4,
      anchor: { kind: "time", t: 12.4 },
    });
    expect(checkLinkLabel(display.check!)).toBe("Check it at 0:12 in V4");
    expect(
      checkLinkLabel({ versionId: id(4), versionOrdinal: 4, anchor: { kind: "slide", index: 2 } }),
    ).toBe("Check slide 3 in V4");
  });
});

describe("notesSummary and sortNotes", () => {
  const notes = [
    note("whole", "open", null, 1),
    note("late", "fixing", { kind: "time", t: 64 }, 2),
    note("early", "fixed", { kind: "time", t: 12 }, 3),
    note("done-old", "resolved", { kind: "time", t: 1 }, 4),
    note("done-new", "resolved", { kind: "time", t: 2 }, 5),
    note("open-2", "open", { kind: "time", t: 42 }, 6),
  ];
  it("counts statuses in the order the user acts on them", () => {
    expect(notesSummary(notes).map((segment) => segment.label)).toEqual([
      "2 open",
      "1 fixed, check it",
      "1 agent fixing",
      "2 resolved",
    ]);
  });
  it("orders unresolved notes by where they sit, whole-video notes last, resolved newest first", () => {
    expect(sortNotes(notes).map((entry) => entry.id)).toEqual([
      "early",
      "open-2",
      "late",
      "whole",
      "done-new",
      "done-old",
    ]);
  });
});

describe("layoutNoteMarkers", () => {
  it("places time notes on the rail and merges close ones under the most urgent status", () => {
    const markers = layoutNoteMarkers(
      [
        note("a", "resolved", { kind: "time", t: 10 }),
        note("b", "open", { kind: "time", t: 10.5 }),
        note("c", "fixed", { kind: "time", t: 45 }),
        note("slide", "open", { kind: "slide", index: 1 }),
        note("past-end", "fixing", { kind: "time", t: 200 }),
      ],
      90,
      0.02,
    );
    expect(markers.map((marker) => [marker.noteIds, marker.status, marker.position])).toEqual([
      [["a", "b"], "open", 10 / 90],
      [["c"], "fixed", 0.5],
      [["past-end"], "fixing", 1],
    ]);
  });
  it("draws nothing without a known duration", () => {
    expect(layoutNoteMarkers([note("a", "open", { kind: "time", t: 1 })], null, 0.02)).toEqual([]);
  });
});

describe("versionStrip and historyAvailability", () => {
  // V1 -> V2 -> V3, then undo to V2 and a new edit made V4 from V2.
  const versions = [v(1, null), v(2, 1), v(3, 2), v(4, 2)];
  it("marks the current version, the alternate left by a fork, and where the fork started", () => {
    expect(
      versionStrip(versions, id(4)).map((item) => [
        item.version.ordinal,
        item.isCurrent,
        item.alternate,
        item.forkedFromOrdinal,
      ]),
    ).toEqual([
      [1, false, false, null],
      [2, false, false, null],
      [3, false, true, null],
      [4, true, false, 2],
    ]);
  });
  it("offers undo and redo along the current line, and says why when it cannot", () => {
    const idle = { versions, turnRunning: false, canOperate: true, pending: false };
    expect(historyAvailability({ ...idle, currentVersionId: id(4) }).undo).toEqual({
      enabled: true,
      target: "v2",
      reason: null,
    });
    expect(historyAvailability({ ...idle, currentVersionId: id(4) }).redo.reason).toBe(
      "Nothing to redo.",
    );
    expect(historyAvailability({ ...idle, currentVersionId: id(2) }).redo.target).toBe("v4");
    expect(historyAvailability({ ...idle, currentVersionId: id(1) }).undo.reason).toBe(
      "This is the first version.",
    );
    const running = historyAvailability({ ...idle, currentVersionId: id(4), turnRunning: true });
    expect(running.undo).toEqual({
      enabled: false,
      target: "v2",
      reason: "Available when the agent finishes this turn.",
    });
    expect(running.restoreBlockedReason).toBe("Available when the agent finishes this turn.");
  });
});

describe("compare selection", () => {
  const versions = [v(1, null), v(2, 1), v(3, 2), v(4, 2)];
  it("starts with the current version against the one it was made from", () => {
    expect(defaultCompareSelection(versions, id(4))).toEqual({ first: "v2", second: "v4" });
    expect(defaultCompareSelection([v(1, null)], id(1))).toBeNull();
  });
  it("replaces the older pick and orders base before target", () => {
    const picked = pickCompareVersion({ first: id(2), second: id(4) }, id(1));
    expect(picked).toEqual({ first: "v4", second: "v1" });
    expect(pickCompareVersion(picked, id(4))).toBe(picked);
    const ordered = orderedCompare(picked, versions);
    expect([ordered?.base.ordinal, ordered?.target.ordinal]).toEqual([1, 4]);
  });
});

describe("agentProgress", () => {
  it("reads the step and render percentage from the agent's own words", () => {
    expect(agentProgress("Rewriting the headline on slide 4 of 9 now.")).toEqual({
      step: "Slide 4 of 9",
      renderPercent: null,
    });
    expect(agentProgress("Shots 1 to 7 done. Rendering shot 8/9, 62% complete")).toEqual({
      step: "Shot 8 of 9",
      renderPercent: 62,
    });
    expect(agentProgress("All done.")).toEqual({ step: null, renderPercent: null });
    expect(agentProgress(null)).toEqual({ step: null, renderPercent: null });
  });
});

describe("shelfStatus", () => {
  const deliverable = {
    id: DeliverableId.make("dlv"),
    projectId: "project" as never,
    kind: "video" as const,
    path: "film.mp4",
    title: "film.mp4",
    currentVersionId: id(2),
    versionCount: 2,
    createdAt: DateTime.makeUnsafe(0),
    updatedAt: DateTime.makeUnsafe(0),
  };
  const snapshot = (overrides: Partial<WorkProjectSnapshot> = {}): WorkProjectSnapshot => ({
    projectId: deliverable.projectId,
    deliverables: [deliverable],
    versions: [v(1, null), v(2, 1)],
    posters: [],
    notes: [],
    reviews: [],
    ...overrides,
  });
  const idle = { status: "idle" as const, activeRunId: null, pendingRuntimeRequest: null };
  const running = { ...idle, status: "running" as const, activeRunId: RunId.make("run") };

  it.each([
    [
      "a thread waits on the user",
      [{ ...idle, status: "waiting" as const }],
      null,
      snapshot(),
      "Waiting for you",
    ],
    [
      "the agent reports a render",
      [running],
      "Rendering 1080p, 60% done",
      snapshot(),
      "Rendering 60%",
    ],
    [
      "the agent names its step",
      [running],
      "Working on slide 4 of 9",
      snapshot(),
      "Agent working · slide 4 of 9",
    ],
    ["nothing was made yet", [], null, snapshot({ deliverables: [], versions: [] }), "Not started"],
    [
      "a reviewer left notes",
      [],
      null,
      snapshot({
        notes: [
          {
            deliverableId: deliverable.id,
            status: "open",
            author: { kind: "external", name: "Sri", source: "review-room" },
          } as never,
        ],
      }),
      "Notes back · 1",
    ],
    [
      "a review integration says so",
      [],
      null,
      snapshot({
        reviews: [
          {
            deliverableId: deliverable.id,
            state: "in_review",
            versionId: id(1),
            source: "review-room",
            label: null,
            url: null,
            updatedAt: DateTime.makeUnsafe(0),
          },
        ],
      }),
      "In review",
    ],
    [
      "the last run failed",
      [{ ...idle, status: "failed" as const, lastErrorClass: "usage_limit" as const }],
      null,
      snapshot(),
      "Usage limit reached",
    ],
    ["idle with a current version", [], null, snapshot(), "Ready to review"],
    [
      "the user's own notes, most pressing first",
      [],
      null,
      snapshot({
        notes: (["open", "open", "fixed", "fixing", "resolved"] as const).map(
          (status) =>
            ({ deliverableId: deliverable.id, status, author: { kind: "user" } }) as never,
        ),
      }),
      "2 notes open · 1 fixed to check · 1 with the agent",
    ],
    [
      "notes on the project's other deliverables too",
      [],
      null,
      snapshot({
        notes: [
          {
            deliverableId: DeliverableId.make("another"),
            status: "open",
            author: { kind: "user" },
          } as never,
        ],
      }),
      "1 note open",
    ],
    [
      "every note resolved",
      [],
      null,
      snapshot({
        notes: [
          { deliverableId: deliverable.id, status: "resolved", author: { kind: "user" } } as never,
        ],
      }),
      "All notes resolved",
    ],
  ])("shows %s", (_name, threads, agentText, value, label) => {
    expect(shelfStatus({ snapshot: value, threads, agentText }).label).toBe(label);
  });

  it("names the version the status is about", () => {
    expect(shelfStatus({ snapshot: snapshot(), threads: [], agentText: null }).version).toBe("V2");
    expect(
      shelfStatus({
        snapshot: snapshot({ deliverables: [], versions: [] }),
        threads: [],
        agentText: null,
      }).version,
    ).toBeNull();
  });
});

describe("workRunFailure", () => {
  const failed = {
    status: "failed" as const,
    latestRunId: RunId.make("run-1"),
    lastError: null,
    lastErrorClass: null,
    lastErrorCode: null,
    usageLimitResetAt: null,
  };

  it.each([
    [
      "a usage limit",
      {
        ...failed,
        lastErrorClass: "usage_limit" as const,
        usageLimitResetAt: "2026-11-09T15:00:00.000Z",
      },
      "usage_limit",
      "Usage limit reached",
    ],
    [
      "a refused permission",
      { ...failed, lastErrorClass: "permission_error" as const },
      "sign_in",
      "Sign-in needed",
    ],
    [
      "an expired login the provider only describes",
      {
        ...failed,
        lastErrorClass: "provider_error" as const,
        lastError: "OAuth token has expired. Please run /login",
      },
      "sign_in",
      "Sign-in needed",
    ],
    [
      "a dropped connection",
      { ...failed, lastErrorClass: "transport_error" as const },
      "connection",
      "Connection lost",
    ],
    [
      "a crash",
      { ...failed, lastError: "Process exited with code 1" },
      "error",
      "The agent hit an error",
    ],
    [
      "an interrupted run",
      { ...failed, status: "interrupted" as const },
      "stopped",
      "Stopped before it finished",
    ],
  ])("names %s in plain words", (_name, thread, kind, title) => {
    const failure = workRunFailure(thread);
    expect(failure?.kind).toBe(kind);
    expect(failure?.title).toBe(title);
    expect(failure?.runId).toBe("run-1");
  });

  it("keeps the reset time of a usage limit", () => {
    expect(
      workRunFailure({
        ...failed,
        lastErrorClass: "usage_limit",
        usageLimitResetAt: "2026-11-09T15:00:00.000Z",
      })?.resetAt,
    ).toBe("2026-11-09T15:00:00.000Z");
  });

  it.each([["running"], ["completed"], ["idle"]] as const)("says nothing while %s", (status) => {
    expect(workRunFailure({ ...failed, status })).toBeNull();
  });

  it("finds the notes the failed run was fixing", () => {
    const failure = workRunFailure(failed);
    const notes = [
      { id: "a", status: "open" as const, sentRunId: RunId.make("run-1") },
      { id: "b", status: "open" as const, sentRunId: RunId.make("run-0") },
      { id: "c", status: "fixed" as const, sentRunId: RunId.make("run-1") },
      { id: "d", status: "open" as const, sentRunId: null },
    ];
    expect(notesFromFailedRun(notes, failure).map((note) => note.id)).toEqual(["a"]);
    expect(notesFromFailedRun(notes, null)).toEqual([]);
  });
});

describe("workChatEntries", () => {
  const message = (
    id: string,
    role: "user" | "assistant",
    text: string,
    runId: string | null,
    createdBy: "user" | "agent" = "user",
  ) => ({
    id: MessageId.make(id),
    role,
    text,
    runId: runId === null ? null : RunId.make(runId),
    createdBy,
  });

  it("keeps the user's own messages and each run's last reply, leaving note messages to their cards", () => {
    const entries = workChatEntries(
      [
        message("m1", "user", "On deck.pptx, V1, about the whole deck:\nWarmer colours", null),
        message("a1", "assistant", "Looking at it", "r1"),
        message("a2", "assistant", "Warmed the palette.", "r1"),
        message("m2", "user", "A note on deck.pptx, V2: ...", null),
        message(
          "a3",
          "assistant",
          "Saved [deck.pptx](C:/Work/deck.pptx) with **slide 2** fixed.",
          "r2",
        ),
        message("w1", "user", "Delegated result", null, "agent"),
      ],
      new Set(["m2"]),
    );
    expect(entries).toEqual([
      { id: "m1", role: "user", text: "Warmer colours" },
      { id: "a2", role: "assistant", text: "Warmed the palette." },
      { id: "a3", role: "assistant", text: "Saved deck.pptx with slide 2 fixed." },
    ]);
  });
});
