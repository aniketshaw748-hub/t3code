import {
  type DeliverableAnchor,
  type DeliverableId,
  type DeliverableNote,
  type DeliverableNoteCreateInput,
  DeliverableNoteError,
  type DeliverableNoteFailureReason,
  DeliverableNoteId,
  type DeliverableNoteSetStatusInput,
  type DeliverableNotesMarkSentInput,
  type DeliverableReviewStatus,
  type DeliverableReviewStatusSetInput,
  type DeliverableVersion,
  type DeliverableVersionId,
  type MessageId,
  type ProjectId,
  type RunId,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Base64 from "effect/encoding/Base64";

import * as AssetAccess from "../assets/AssetAccess.ts";
import * as DeliverableNoteRepository from "../persistence/DeliverableNotes.ts";
import * as DeliverableRepository from "../persistence/Deliverables.ts";
import * as DeliverableBlobStore from "./DeliverableBlobStore.ts";
import { adoptRunNotes, settleRunNotes } from "./noteLifecycle.ts";
import { versionSummary } from "./versionSummary.ts";
import * as WorkProjectEvents from "./WorkProjectEvents.ts";

const fail = (reason: DeliverableNoteFailureReason) => (cause?: unknown) =>
  new DeliverableNoteError({ reason, ...(cause === undefined ? {} : { cause }) });

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DATA_URL_PREFIX = "data:image/png;base64,";
const MAX_REPLY = 600;

/** Notes left on deliverable versions and the lifecycle they go through with the agent. */
export class DeliverableNotes extends Context.Service<
  DeliverableNotes,
  {
    readonly list: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<DeliverableNote>, DeliverableNoteError>;
    readonly create: (
      input: DeliverableNoteCreateInput,
    ) => Effect.Effect<DeliverableNote, DeliverableNoteError>;
    readonly markSent: (
      input: DeliverableNotesMarkSentInput,
    ) => Effect.Effect<ReadonlyArray<DeliverableNote>, DeliverableNoteError>;
    readonly setStatus: (
      input: DeliverableNoteSetStatusInput,
    ) => Effect.Effect<DeliverableNote, DeliverableNoteError>;
    readonly remove: (noteId: DeliverableNoteId) => Effect.Effect<void, DeliverableNoteError>;
    /** The agent says it addressed these notes; they are fixed once its run makes a version. */
    readonly markFixed: (input: {
      readonly projectId: ProjectId;
      readonly noteIds: ReadonlyArray<DeliverableNoteId>;
      readonly reply: string;
      readonly checkAnchor: DeliverableAnchor | null;
      readonly runId: RunId | undefined;
    }) => Effect.Effect<ReadonlyArray<DeliverableNote>, DeliverableNoteError>;
    readonly listReviews: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<DeliverableReviewStatus>, DeliverableNoteError>;
    readonly setReviewStatus: (
      input: DeliverableReviewStatusSetInput,
    ) => Effect.Effect<void, DeliverableNoteError>;
    /** Links notes sent by a user message to the run that message started. */
    readonly linkRun: (input: {
      readonly messageId: MessageId;
      readonly runId: RunId;
    }) => Effect.Effect<void, DeliverableNoteError>;
    /** Moves the notes a run worked on, as its versions arrive and when it ends (`final`). */
    readonly settleRun: (input: {
      readonly projectId: ProjectId;
      readonly runId: RunId;
      readonly final: boolean;
    }) => Effect.Effect<void, DeliverableNoteError>;
    readonly projectsForRun: (
      runId: RunId,
    ) => Effect.Effect<ReadonlyArray<ProjectId>, DeliverableNoteError>;
    /** A stray file became `version`: its run's notes are fixed there, its own notes move over. */
    readonly adoptVersion: (input: {
      readonly projectId: ProjectId;
      readonly runId: RunId | null;
      readonly strayDeliverableId: DeliverableId;
      readonly version: DeliverableVersion;
    }) => Effect.Effect<void, DeliverableNoteError>;
  }
>()("t3/deliverables/DeliverableNotes") {}

const make = Effect.gen(function* () {
  const notes = yield* DeliverableNoteRepository.DeliverableNoteRepository;
  const deliverables = yield* DeliverableRepository.DeliverableRepository;
  const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;
  const events = yield* WorkProjectEvents.WorkProjectEvents;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const assetContext =
    yield* Effect.context<
      Effect.Services<ReturnType<typeof AssetAccess.issueDeliverableFileUrl>>
    >();
  // Read-modify-write of a project's notes takes turns, so the reactor and clients never race.
  const projectLock = yield* KeyedLock.make<ProjectId>();

  const persistence = Effect.mapError(fail("persistence_failed"));
  const changed = (projectId: ProjectId) => events.publish({ type: "changed", projectId });

  const toPublic = Effect.fn("DeliverableNotes.toPublic")(function* (
    stored: DeliverableNoteRepository.StoredDeliverableNote,
  ) {
    const { snapshotPath, ...note } = stored;
    const snapshotUrl =
      snapshotPath === null
        ? null
        : yield* AssetAccess.issueDeliverableFileUrl({
            relativePath: snapshotPath,
            mimeType: "image/png",
          }).pipe(
            Effect.provide(assetContext),
            Effect.orElseSucceed(() => null),
          );
    return { ...note, snapshotUrl } satisfies DeliverableNote;
  });

  const loadNote = (noteId: DeliverableNoteId) =>
    notes.getNote(noteId).pipe(
      persistence,
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(fail("note_not_found")()),
          onSome: Effect.succeed,
        }),
      ),
    );

  const loadDeliverable = (deliverableId: DeliverableId) =>
    deliverables.getDeliverable(deliverableId).pipe(
      persistence,
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(fail("deliverable_not_found")()),
          onSome: Effect.succeed,
        }),
      ),
    );

  const writeSnapshot = Effect.fn("DeliverableNotes.writeSnapshot")(function* (
    noteId: DeliverableNoteId,
    dataUrl: string,
  ) {
    const decoded = Base64.decode(dataUrl.slice(DATA_URL_PREFIX.length));
    if (Result.isFailure(decoded)) return yield* fail("snapshot_invalid")();
    const bytes = decoded.success;
    if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
      return yield* fail("snapshot_invalid")();
    }
    const relativePath = `notes/${noteId}.png`;
    const target = path.join(blobs.root, "notes", `${noteId}.png`);
    yield* fileSystem
      .makeDirectory(path.dirname(target), { recursive: true })
      .pipe(
        Effect.andThen(fileSystem.writeFile(target, bytes)),
        Effect.mapError(fail("storage_failed")),
      );
    return relativePath;
  });

  const create: DeliverableNotes["Service"]["create"] = Effect.fn("DeliverableNotes.create")(
    function* (input) {
      const deliverable = yield* loadDeliverable(input.deliverableId);
      const version = yield* deliverables.getVersion(input.versionId).pipe(persistence);
      if (Option.isNone(version)) return yield* fail("version_not_found")();
      if (version.value.deliverableId !== deliverable.id) return yield* fail("version_mismatch")();
      const id = DeliverableNoteId.make(`note_${(yield* random.uuidV4()).replaceAll("-", "")}`);
      const snapshotPath =
        input.snapshotDataUrl === undefined
          ? null
          : yield* writeSnapshot(id, input.snapshotDataUrl);
      const now = yield* DateTime.now;
      const stored: DeliverableNoteRepository.StoredDeliverableNote = {
        id,
        projectId: deliverable.projectId,
        deliverableId: deliverable.id,
        versionId: input.versionId,
        anchor: input.anchor,
        body: input.body,
        author:
          input.author === undefined
            ? { kind: "user", name: null, source: null }
            : { kind: "external", name: input.author.name, source: input.author.source },
        snapshotPath,
        status: "open",
        threadId: null,
        sentMessageId: null,
        sentRunId: null,
        addressedRunId: null,
        reply: null,
        checkAnchor: null,
        fixedInVersionId: null,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
      };
      yield* notes.putNote(stored).pipe(persistence);
      yield* changed(deliverable.projectId);
      return yield* toPublic(stored);
    },
  );

  /** Applies `update` to each note under its project's lock and publishes one change. */
  const updateNotes = Effect.fn("DeliverableNotes.updateNotes")(function* (
    noteIds: ReadonlyArray<DeliverableNoteId>,
    update: (
      note: DeliverableNoteRepository.StoredDeliverableNote,
      now: DateTime.Utc,
    ) => Effect.Effect<DeliverableNoteRepository.StoredDeliverableNote, DeliverableNoteError>,
  ) {
    const first = yield* loadNote(noteIds[0]!);
    const projectId = first.projectId;
    const updated = yield* projectLock.withLock(
      projectId,
      Effect.forEach(noteIds, (noteId) =>
        Effect.gen(function* () {
          const note = yield* loadNote(noteId);
          if (note.projectId !== projectId) return yield* fail("note_not_found")();
          const next = yield* update(note, yield* DateTime.now);
          yield* notes.putNote(next).pipe(persistence);
          return next;
        }),
      ),
    );
    yield* changed(projectId);
    return yield* Effect.forEach(updated, toPublic);
  });

  const markSent: DeliverableNotes["Service"]["markSent"] = Effect.fn("DeliverableNotes.markSent")(
    function* (input) {
      return yield* updateNotes(input.noteIds, (note, now) =>
        note.status === "resolved"
          ? Effect.fail(fail("note_resolved")())
          : Effect.succeed({
              ...note,
              status: "fixing",
              threadId: input.threadId,
              sentMessageId: input.messageId,
              sentRunId: null,
              addressedRunId: null,
              reply: null,
              checkAnchor: null,
              fixedInVersionId: null,
              updatedAt: now,
            }),
      );
    },
  );

  const setStatus: DeliverableNotes["Service"]["setStatus"] = Effect.fn(
    "DeliverableNotes.setStatus",
  )(function* (input) {
    const [note] = yield* updateNotes([input.noteId], (note, now) =>
      Effect.succeed(
        input.status === "resolved"
          ? { ...note, status: "resolved", resolvedAt: now, updatedAt: now }
          : // Reopening starts a new round: the old fix no longer counts.
            { ...note, status: "open", fixedInVersionId: null, resolvedAt: null, updatedAt: now },
      ),
    );
    return note!;
  });

  const remove: DeliverableNotes["Service"]["remove"] = Effect.fn("DeliverableNotes.remove")(
    function* (noteId) {
      const note = yield* loadNote(noteId);
      yield* notes.deleteNote(noteId).pipe(persistence);
      if (note.snapshotPath !== null) {
        yield* fileSystem
          .remove(path.join(blobs.root, ...note.snapshotPath.split("/")))
          .pipe(Effect.ignore);
      }
      yield* changed(note.projectId);
    },
  );

  const runVersions = Effect.fn("DeliverableNotes.runVersions")(function* (
    projectId: ProjectId,
    runId: RunId,
  ) {
    const list = yield* deliverables.listDeliverables(projectId).pipe(persistence);
    const versions = yield* Effect.forEach(list, (deliverable) =>
      deliverables.listVersions(deliverable.id).pipe(persistence),
    );
    return versions
      .flat()
      .filter((version) => version.source.runId === runId)
      .map((version) => ({ ...version, summary: versionSummary(version.summary) }));
  });

  const settleRun: DeliverableNotes["Service"]["settleRun"] = Effect.fn(
    "DeliverableNotes.settleRun",
  )(function* (input) {
    const patched = yield* projectLock.withLock(
      input.projectId,
      Effect.gen(function* () {
        const projectNotes = yield* notes.listNotes(input.projectId).pipe(persistence);
        const patches = settleRunNotes({
          notes: projectNotes,
          runId: input.runId,
          runVersions: yield* runVersions(input.projectId, input.runId),
          final: input.final,
        });
        if (patches.length === 0) return false;
        const now = yield* DateTime.now;
        const byId = new Map(projectNotes.map((note) => [note.id, note]));
        yield* Effect.forEach(
          patches,
          ({ noteId, ...patch }) => {
            const note = byId.get(noteId);
            return note === undefined
              ? Effect.void
              : notes.putNote({ ...note, ...patch, updatedAt: now }).pipe(persistence);
          },
          { discard: true },
        );
        return true;
      }),
    );
    if (patched) yield* changed(input.projectId);
  });

  const adoptVersion: DeliverableNotes["Service"]["adoptVersion"] = Effect.fn(
    "DeliverableNotes.adoptVersion",
  )(function* (input) {
    const patched = yield* projectLock.withLock(
      input.projectId,
      Effect.gen(function* () {
        const projectNotes = yield* notes.listNotes(input.projectId).pipe(persistence);
        const patches = adoptRunNotes({
          notes: projectNotes,
          runId: input.runId,
          strayDeliverableId: input.strayDeliverableId,
          version: input.version,
        });
        const now = yield* DateTime.now;
        const byId = new Map(projectNotes.map((note) => [note.id, note]));
        yield* Effect.forEach(
          patches,
          ({ noteId, ...patch }) => {
            const note = byId.get(noteId);
            return note === undefined
              ? Effect.void
              : notes.putNote({ ...note, ...patch, updatedAt: now }).pipe(persistence);
          },
          { discard: true },
        );
        return patches.length > 0;
      }),
    );
    if (patched) yield* changed(input.projectId);
  });

  const markFixed: DeliverableNotes["Service"]["markFixed"] = Effect.fn(
    "DeliverableNotes.markFixed",
  )(function* (input) {
    if (input.noteIds.length === 0) return [];
    const reply = input.reply.trim().slice(0, MAX_REPLY);
    const updated = yield* updateNotes(input.noteIds, (note, now) =>
      note.projectId !== input.projectId
        ? Effect.fail(fail("note_not_found")())
        : Effect.succeed({
            ...note,
            // A note read straight from the review list was never sent; this run took it on.
            status: note.status === "resolved" ? note.status : "fixing",
            addressedRunId: input.runId ?? null,
            reply: reply.length === 0 ? note.reply : reply,
            checkAnchor: input.checkAnchor,
            updatedAt: now,
          }),
    );
    if (input.runId === undefined) return updated;
    yield* settleRun({ projectId: input.projectId, runId: input.runId, final: false });
    return yield* Effect.forEach(input.noteIds, (noteId) =>
      loadNote(noteId).pipe(Effect.flatMap(toPublic)),
    );
  });

  const setReviewStatus: DeliverableNotes["Service"]["setReviewStatus"] = Effect.fn(
    "DeliverableNotes.setReviewStatus",
  )(function* (input) {
    const deliverable = yield* loadDeliverable(input.deliverableId);
    if (input.state === null) {
      yield* notes.deleteReview(deliverable.id).pipe(persistence);
    } else {
      yield* notes
        .putReview({
          deliverableId: deliverable.id,
          state: input.state,
          versionId: (input.versionId ?? null) as DeliverableVersionId | null,
          source: input.source,
          label: input.label ?? null,
          url: input.url ?? null,
          updatedAt: yield* DateTime.now,
        })
        .pipe(persistence);
    }
    yield* changed(deliverable.projectId);
  });

  return DeliverableNotes.of({
    list: Effect.fn("DeliverableNotes.list")(function* (projectId) {
      const stored = yield* notes.listNotes(projectId).pipe(persistence);
      return yield* Effect.forEach(stored, toPublic);
    }),
    create,
    markSent,
    setStatus,
    remove,
    markFixed,
    listReviews: Effect.fn("DeliverableNotes.listReviews")(function* (projectId) {
      return yield* notes.listReviews(projectId).pipe(persistence);
    }),
    setReviewStatus,
    linkRun: Effect.fn("DeliverableNotes.linkRun")(function* (input) {
      const projects = yield* notes.linkRun(input).pipe(persistence);
      yield* Effect.forEach(projects, changed, { discard: true });
    }),
    settleRun,
    projectsForRun: Effect.fn("DeliverableNotes.projectsForRun")(function* (runId) {
      return yield* notes.projectsForRun(runId).pipe(persistence);
    }),
    adoptVersion,
  });
});

export const layer = Layer.effect(DeliverableNotes, make);
