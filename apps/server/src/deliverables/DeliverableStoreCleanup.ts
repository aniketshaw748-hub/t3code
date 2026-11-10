import { DeliverableError, type DeliverableKind } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as DeliverableRepository from "../persistence/Deliverables.ts";
import * as DeliverableBlobStore from "./DeliverableBlobStore.ts";
import * as DeliverableContext from "./DeliverableContext.ts";
import * as DeliverableGit from "./DeliverableGit.ts";
import * as DeliverableRenderers from "./DeliverableRenderers.ts";

/** What one cleanup took out of the store. */
export interface CleanupReport {
  readonly blobs: number;
  readonly renditions: number;
  readonly renditionFiles: number;
  readonly noteSnapshots: number;
  readonly bytes: number;
  /**
   * False when some version's snapshot could not be read, so what it points at is unknown and
   * every stored file was kept.
   */
  readonly blobsSwept: boolean;
}

/**
 * Removes from the store what no version, rendition or note points at any more. It runs when the
 * server starts and after a deliverable or project is removed: the only times anything stops
 * being needed, and never on the path of recording a version.
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

const decodeRenderOutput = Schema.decodeUnknownOption(DeliverableRenderers.RenderOutput);

/** Files a ready rendition still uses; null when its record cannot be read, so all are kept. */
function renditionFiles(data: unknown): ReadonlySet<string> | null {
  const output = decodeRenderOutput(data);
  if (output._tag === "None") return null;
  const { poster, proxy, samples, units } = output.value;
  const files = [poster, proxy, samples?.file ?? null];
  for (const unit of units) {
    files.push(unit.image, unit.thumb);
    if (unit.signature !== null && "file" in unit.signature) files.push(unit.signature.file);
  }
  return new Set(files.filter((file) => file !== null));
}

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
   * at. A commit that cannot be read now is tried again next time.
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

  const sweep = Effect.fn("DeliverableStoreCleanup.sweep")(function* () {
    const unlisted = (yield* repository.listVersionsWithoutBlobs.pipe(persistence)).length;
    const references = yield* repository.storeReferences.pipe(persistence);
    const report = { blobs: 0, renditions: 0, renditionFiles: 0, noteSnapshots: 0, bytes: 0 };

    // A row goes before its files: a crash in between leaves files nothing names, which the
    // next cleanup removes, never a row naming files that are gone.
    const rows = yield* repository.listRenditions.pipe(persistence);
    const kept = new Map<string, ReadonlySet<string> | null>();
    for (const row of rows) {
      const key = DeliverableRepository.renditionKey(row);
      if (!references.renditions.has(key)) {
        yield* repository.deleteRendition(row).pipe(persistence);
        report.renditions += 1;
      } else if (row.status === "ready") {
        kept.set(key, renditionFiles(row.data));
      }
    }
    const keyOf = (sha256: string, kind: string) =>
      DeliverableRepository.renditionKey({ contentSha256: sha256, kind: kind as DeliverableKind });
    for (const file of yield* blobs.listFiles("renditions").pipe(storage)) {
      const [, sha256, kind, ...rest] = file.path.split("/");
      if (sha256 === undefined || kind === undefined || rest.length === 0) continue;
      const key = keyOf(sha256, kind);
      // No render is running while this holds the store, so anything a ready rendition does not
      // name, and everything beside one that is not ready, is left over from an earlier render.
      const named = references.renditions.has(key) ? kept.get(key) : undefined;
      if (named === null || (named !== undefined && named.has(rest.join("/")))) continue;
      report.bytes += file.sizeBytes;
      if (!references.renditions.has(key)) continue;
      yield* blobs.remove(file.path).pipe(storage);
      report.renditionFiles += 1;
    }
    // Folders of renditions no version shows go whole, the content's folder with its last kind.
    const folders = yield* blobs.listRenditionFolders.pipe(storage);
    for (const sha256 of new Set(folders.map((folder) => folder.sha256))) {
      const kinds = folders.filter((folder) => folder.sha256 === sha256);
      const unused = kinds.filter(
        (folder) => !references.renditions.has(keyOf(sha256, folder.kind)),
      );
      if (unused.length === kinds.length) {
        yield* blobs.remove(`renditions/${sha256}`).pipe(storage);
        continue;
      }
      for (const folder of unused) {
        yield* blobs.remove(`renditions/${sha256}/${folder.kind}`).pipe(storage);
      }
    }

    if (unlisted === 0) {
      for (const file of yield* blobs.listFiles("objects").pipe(storage)) {
        const sha256 = DeliverableBlobStore.blobShaOfPath(file.path);
        if (sha256 !== null && references.blobs.has(sha256)) continue;
        // Anything not named by its hash is a write a crash cut short.
        if (sha256 !== null) yield* repository.forgetBlob(sha256).pipe(persistence);
        yield* blobs.remove(file.path).pipe(storage);
        report.blobs += sha256 === null ? 0 : 1;
        report.bytes += file.sizeBytes;
      }
    }

    for (const file of yield* blobs.listFiles("notes").pipe(storage)) {
      if (references.noteSnapshots.has(file.path)) continue;
      yield* blobs.remove(file.path).pipe(storage);
      report.noteSnapshots += 1;
      report.bytes += file.sizeBytes;
    }
    return { ...report, blobsSwept: unlisted === 0 } satisfies CleanupReport;
  });

  const run: DeliverableStoreCleanup["Service"]["run"] = Effect.gen(function* () {
    yield* recordBlobLists();
    // Writers add bytes first and the row that needs them after; none is between the two here.
    const report = yield* blobs.whileCleaning(sweep());
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
