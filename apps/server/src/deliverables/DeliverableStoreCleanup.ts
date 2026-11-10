import { DeliverableError, type DeliverableKind } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as DeliverableRepository from "../persistence/Deliverables.ts";
import * as DeliverableBlobStore from "./DeliverableBlobStore.ts";
import * as DeliverableContext from "./DeliverableContext.ts";
import * as DeliverableGit from "./DeliverableGit.ts";

/** What one cleanup took out of the store. */
export interface CleanupReport {
  readonly blobs: number;
  readonly renditions: number;
  readonly noteSnapshots: number;
  readonly bytes: number;
  /** Version refs of deleted history that Git confirmed gone. */
  readonly refs: number;
  /**
   * Why no file was deleted, when a rule held everything back: some version's snapshot could not
   * be read, so what is still needed is not fully known, or the database could not be synced.
   */
  readonly kept: "unlisted-versions" | "not-on-disk" | null;
}

/**
 * Removes from the store what no version, rendition or note points at any more, and tells Git to
 * drop the refs of deleted history. It never decides that history should go: only an explicit
 * purge or adopting a stray file removes versions. It runs when the server starts and after
 * those, never on the path of recording a version.
 */
export class DeliverableStoreCleanup extends Context.Service<
  DeliverableStoreCleanup,
  {
    readonly run: Effect.Effect<CleanupReport, DeliverableError>;
    /** Asks for a cleanup on the background queue; asks made while one waits are one. */
    readonly request: Effect.Effect<void>;
    /** Resolves once requested cleanups have finished. */
    readonly drain: Effect.Effect<void>;
  }
>()("t3/deliverables/DeliverableStoreCleanup") {}

const make = Effect.gen(function* () {
  const repository = yield* DeliverableRepository.DeliverableRepository;
  const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;
  const git = yield* DeliverableGit.DeliverableGit;
  const context = yield* DeliverableContext.DeliverableContext;

  const persistence = Effect.mapError(
    (cause: unknown) => new DeliverableError({ reason: "persistence_failed", cause }),
  );
  const storage = Effect.mapError(
    (cause: unknown) => new DeliverableError({ reason: "storage_failed", cause }),
  );

  /**
   * Lists, for versions made before snapshots recorded it, the stored files their commits point
   * at. A commit that cannot be read in full now is tried again next time.
   */
  const recordBlobLists = Effect.fn("DeliverableStoreCleanup.recordBlobLists")(function* () {
    const versions = yield* repository.listVersionsWithoutBlobs.pipe(persistence);
    yield* Effect.forEach(
      versions,
      (version) =>
        Effect.gen(function* () {
          const project = yield* context.projectState(version.projectId);
          if (project.type !== "active" && project.type !== "deleted") return;
          const stored = yield* git.storedBlobs({
            cwd: project.workspaceRoot,
            commit: version.commitOid,
          });
          yield* repository.recordVersionBlobs({
            versionId: version.versionId,
            blobs: [version.contentSha256, ...stored],
          });
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not read what a deliverable version's snapshot stores", {
              versionId: version.versionId,
              error: error.message,
            }),
          ),
        ),
      { discard: true },
    );
  });

  const nothing = { blobs: 0, renditions: 0, noteSnapshots: 0, bytes: 0 };

  const sweep = Effect.fn("DeliverableStoreCleanup.sweep")(function* () {
    // One rule for every kind of file: unless what is still needed is known in full, nothing goes.
    const unlisted = (yield* repository.listVersionsWithoutBlobs.pipe(persistence)).length;
    if (unlisted > 0) return { ...nothing, kept: "unlisted-versions" as const };
    const references = yield* repository.storeReferences.pipe(persistence);

    const keyOf = (sha256: string, kind: string) =>
      DeliverableRepository.renditionKey({ contentSha256: sha256, kind: kind as DeliverableKind });
    const rows = (yield* repository.listRenditions.pipe(persistence)).filter(
      (row) => !references.renditions.has(DeliverableRepository.renditionKey(row)),
    );
    // Only whole renditions no version shows; a rendition in use keeps every file in its folder.
    const folders = (yield* blobs.listRenditionFolders.pipe(storage)).filter(
      (folder) => !references.renditions.has(keyOf(folder.sha256, folder.kind)),
    );
    const renditionFiles = (yield* blobs.listFiles("renditions").pipe(storage)).filter((file) => {
      const [, sha256, kind] = file.path.split("/");
      return folders.some((folder) => folder.sha256 === sha256 && folder.kind === (kind ?? ""));
    });
    // Anything in `objects` not named by its hash is a write a crash cut short.
    const objects = (yield* blobs.listFiles("objects").pipe(storage)).flatMap((file) => {
      const sha256 = DeliverableBlobStore.blobShaOfPath(file.path);
      return sha256 !== null && references.blobs.has(sha256) ? [] : [{ ...file, sha256 }];
    });
    const pictures = (yield* blobs.listFiles("notes").pipe(storage)).filter(
      (file) => !references.noteSnapshots.has(file.path),
    );
    if (rows.length + folders.length + objects.length + pictures.length === 0) {
      return { ...nothing, kept: null };
    }

    // Rows first, then the sync, then files. A crash or a power cut at any point leaves either
    // rows still naming files that exist, or files nothing names, which the next cleanup takes:
    // never a row naming a file that is gone.
    yield* Effect.forEach(rows, (row) => repository.deleteRendition(row), { discard: true }).pipe(
      persistence,
    );
    yield* Effect.forEach(
      objects,
      (file) => (file.sha256 === null ? Effect.void : repository.forgetBlob(file.sha256)),
      { discard: true },
    ).pipe(persistence);
    if (!(yield* repository.flushToDisk.pipe(persistence))) {
      return { ...nothing, kept: "not-on-disk" as const };
    }

    yield* Effect.forEach(
      folders,
      (folder) =>
        blobs.remove(
          folder.kind === ""
            ? `renditions/${folder.sha256}`
            : `renditions/${folder.sha256}/${folder.kind}`,
        ),
      { discard: true },
    ).pipe(storage);
    // The content's own folder goes with its last kind.
    yield* Effect.forEach(
      (yield* blobs.listRenditionFolders.pipe(storage)).filter((folder) => folder.kind === ""),
      (folder) => blobs.remove(`renditions/${folder.sha256}`),
      { discard: true },
    ).pipe(storage);
    yield* Effect.forEach([...objects, ...pictures], (file) => blobs.remove(file.path), {
      discard: true,
    }).pipe(storage);
    return {
      blobs: objects.filter((file) => file.sha256 !== null).length,
      renditions: folders.filter((folder) => folder.kind !== "").length,
      noteSnapshots: pictures.length,
      bytes: [...renditionFiles, ...objects, ...pictures].reduce(
        (sum, file) => sum + file.sizeBytes,
        0,
      ),
      kept: null,
    };
  });

  /**
   * Deletes the version refs that deleted history left owed, one project folder at a time. A
   * folder Git cannot reach keeps its refs on the list for the next cleanup.
   */
  const deleteOwedRefs = Effect.fn("DeliverableStoreCleanup.deleteOwedRefs")(function* () {
    const owed = yield* repository.listPendingRefDeletions.pipe(persistence);
    // The versions must be gone for good first: a power cut could bring their rows back.
    if (owed.length === 0 || !(yield* repository.flushToDisk.pipe(persistence))) return 0;
    const deleted = yield* Effect.forEach(
      [...new Set(owed.map((entry) => entry.workspaceRoot))],
      (workspaceRoot) => {
        const refs = owed
          .filter((entry) => entry.workspaceRoot === workspaceRoot)
          .map((entry) => entry.ref);
        return git.deleteRefs({ cwd: workspaceRoot, refs }).pipe(
          Effect.andThen(repository.completeRefDeletions({ workspaceRoot, refs })),
          Effect.as(refs.length),
          Effect.catch((error) =>
            Effect.as(
              Effect.logWarning("Could not delete the version refs of deleted history yet", {
                workspaceRoot,
                refs: refs.length,
                error: error.message,
              }),
              0,
            ),
          ),
        );
      },
    );
    return deleted.reduce((sum, count) => sum + count, 0);
  });

  const run: DeliverableStoreCleanup["Service"]["run"] = Effect.gen(function* () {
    yield* recordBlobLists();
    // Writers add bytes first and the row that needs them after; none is between the two here.
    const swept = yield* blobs.whileCleaning(sweep());
    const report = { ...swept, refs: yield* deleteOwedRefs() } satisfies CleanupReport;
    yield* Effect.logInfo("Cleaned the deliverable store", report);
    return report;
  }).pipe(Effect.withSpan("DeliverableStoreCleanup.run"));

  const waiting = yield* Ref.make(false);
  const worker = yield* makeDrainableWorker((_: void) =>
    Ref.set(waiting, false).pipe(
      Effect.andThen(run),
      Effect.catch((error) =>
        Effect.logWarning("Could not clean the deliverable store", {
          reason: error.reason,
          cause: error.cause,
        }),
      ),
    ),
  );

  return DeliverableStoreCleanup.of({
    run,
    request: Ref.getAndSet(waiting, true).pipe(
      Effect.flatMap((already) => (already ? Effect.void : worker.enqueue())),
    ),
    drain: worker.drain,
  });
});

export const layer = Layer.effect(DeliverableStoreCleanup, make);
