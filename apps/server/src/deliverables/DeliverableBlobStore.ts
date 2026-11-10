// @effect-diagnostics nodeBuiltinImport:off - effect's Digest hashes one buffer; media must stream.
import * as NodeCrypto from "node:crypto";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as ServerConfig from "../config.ts";

export class DeliverableBlobStoreError extends Schema.TaggedError<DeliverableBlobStoreError>()(
  "DeliverableBlobStoreError",
  {
    operation: Schema.Literals(["ingest", "hash", "materialize", "stage", "usage", "sweep"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Deliverable blob store ${this.operation} failed.`;
  }
}

export interface StoredBlob {
  readonly sha256: string;
  readonly sizeBytes: number;
}

/** A file in the store that nothing was said to need, as cleanup lists them. */
export interface StoredFile {
  /** Relative to the store root, forward slashes. */
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: Date | null;
}

/**
 * Content-addressed bytes under `<userdata>/deliverables`. Blobs use Git LFS's object layout
 * (`objects/ab/cd/<sha256>`), so `lfs.storage` can point at this directory. Only
 * DeliverableStoreCleanup deletes from it, and only while `whileCleaning` keeps writers out.
 */
export class DeliverableBlobStore extends Context.Service<
  DeliverableBlobStore,
  {
    readonly root: string;
    /** Hashes a file and stores a copy, or moves it in when `move` is set. Dedupes by hash. */
    readonly ingest: (input: {
      readonly path: string;
      readonly move?: boolean;
    }) => Effect.Effect<StoredBlob, DeliverableBlobStoreError>;
    readonly blobPath: (sha256: string) => string;
    readonly hash: (path: string) => Effect.Effect<StoredBlob, DeliverableBlobStoreError>;
    readonly has: (sha256: string) => Effect.Effect<boolean>;
    /** Writes a blob's bytes to `destination`, replacing it atomically. */
    readonly materialize: (input: {
      readonly sha256: string;
      readonly destination: string;
    }) => Effect.Effect<void, DeliverableBlobStoreError>;
    readonly renditionDir: (input: { readonly sha256: string; readonly kind: string }) => string;
    /** A fresh scratch directory inside the store, removed when the scope closes. */
    readonly scratchDir: Effect.Effect<string, DeliverableBlobStoreError, Scope.Scope>;
    readonly usage: Effect.Effect<
      { readonly blobCount: number; readonly bytes: number },
      DeliverableBlobStoreError
    >;
    /**
     * Runs `effect` while no cleanup is running. Everything that adds to the store goes through
     * it, from the first byte written to the row that says the bytes are needed.
     */
    readonly whileWriting: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
    /** Runs `effect` once every writer has left, and keeps new ones out until it ends. */
    readonly whileCleaning: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
    /** Every file under one of the store's folders (`objects`, `renditions`, `notes`). */
    readonly listFiles: (
      folder: "objects" | "renditions" | "notes",
    ) => Effect.Effect<ReadonlyArray<StoredFile>, DeliverableBlobStoreError>;
    /** The rendition folders that exist, whether or not a rendition was ever recorded for them. */
    readonly listRenditionFolders: Effect.Effect<
      ReadonlyArray<{ readonly sha256: string; readonly kind: string }>,
      DeliverableBlobStoreError
    >;
    /** Deletes a file or folder by its store-relative path; missing is fine. */
    readonly remove: (relativePath: string) => Effect.Effect<void, DeliverableBlobStoreError>;
  }
>()("t3/deliverables/DeliverableBlobStore") {}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
/** Writers that may be in the store together; cleanup takes every place at once. */
const WRITER_PLACES = 64;

/** The content hash a path under `objects` stores, or null for anything else in there. */
export const blobShaOfPath = (relativePath: string): string | null => {
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  return SHA256_PATTERN.test(name) ? name : null;
};

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const root = path.join(config.stateDir, "deliverables");
  const objectsDir = path.join(root, "objects");
  const scratchRoot = path.join(root, "tmp");
  const writers = yield* Semaphore.make(WRITER_PLACES);
  // Scratch folders belong to the process that made them; none of this one's exist yet.
  yield* fileSystem.remove(scratchRoot, { recursive: true, force: true }).pipe(Effect.ignore);

  const blobPath = (sha256: string) => {
    if (!SHA256_PATTERN.test(sha256)) throw new TypeError("Not a sha256 hex digest.");
    return path.join(objectsDir, sha256.slice(0, 2), sha256.slice(2, 4), sha256);
  };

  const hashFile = Effect.fn("DeliverableBlobStore.hashFile")(function* (file: string) {
    const hash = NodeCrypto.createHash("sha256");
    let sizeBytes = 0;
    yield* Stream.runForEach(fileSystem.stream(file), (chunk) =>
      Effect.sync(() => {
        hash.update(chunk);
        sizeBytes += chunk.byteLength;
      }),
    );
    return { sha256: hash.digest("hex"), sizeBytes } satisfies StoredBlob;
  });

  const has: DeliverableBlobStore["Service"]["has"] = (sha256) =>
    fileSystem.exists(blobPath(sha256)).pipe(Effect.orElseSucceed(() => false));

  const tempName = Effect.map(random.uuidV4(), (id) => `.partial-${id}`);

  const ingest: DeliverableBlobStore["Service"]["ingest"] = Effect.fn(
    "DeliverableBlobStore.ingest",
  )(
    function* (input) {
      const blob = yield* hashFile(input.path);
      const target = blobPath(blob.sha256);
      if (yield* has(blob.sha256)) {
        if (input.move === true) yield* fileSystem.remove(input.path, { force: true });
        return blob;
      }
      yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true });
      const partial = path.join(path.dirname(target), yield* tempName);
      if (input.move === true) yield* fileSystem.rename(input.path, partial);
      else yield* fileSystem.copyFile(input.path, partial);
      yield* fileSystem.rename(partial, target);
      return blob;
    },
    Effect.mapError((cause) => new DeliverableBlobStoreError({ operation: "ingest", cause })),
  );

  const materialize: DeliverableBlobStore["Service"]["materialize"] = Effect.fn(
    "DeliverableBlobStore.materialize",
  )(
    function* (input) {
      yield* fileSystem.makeDirectory(path.dirname(input.destination), { recursive: true });
      const partial = `${input.destination}${yield* tempName}`;
      yield* fileSystem.copyFile(blobPath(input.sha256), partial);
      yield* fileSystem.rename(partial, input.destination);
    },
    Effect.mapError((cause) => new DeliverableBlobStoreError({ operation: "materialize", cause })),
  );

  const scratchDir = Effect.acquireRelease(
    Effect.gen(function* () {
      yield* fileSystem.makeDirectory(scratchRoot, { recursive: true });
      return yield* fileSystem.makeTempDirectory({ directory: scratchRoot });
    }).pipe(
      Effect.mapError((cause) => new DeliverableBlobStoreError({ operation: "stage", cause })),
    ),
    (directory) =>
      fileSystem.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore),
  );

  const usage = Effect.gen(function* () {
    if (!(yield* fileSystem.exists(objectsDir))) return { blobCount: 0, bytes: 0 };
    let blobCount = 0;
    let bytes = 0;
    for (const entry of yield* fileSystem.readDirectory(objectsDir, { recursive: true })) {
      if (!SHA256_PATTERN.test(path.basename(entry))) continue;
      const info = yield* fileSystem.stat(path.join(objectsDir, entry));
      blobCount += 1;
      bytes += Number(info.size);
    }
    return { blobCount, bytes };
  }).pipe(
    Effect.mapError((cause) => new DeliverableBlobStoreError({ operation: "usage", cause })),
    Effect.withSpan("DeliverableBlobStore.usage"),
  );

  const listFiles: DeliverableBlobStore["Service"]["listFiles"] = Effect.fn(
    "DeliverableBlobStore.listFiles",
  )(
    function* (folder) {
      const directory = path.join(root, folder);
      if (!(yield* fileSystem.exists(directory))) return [];
      const files: StoredFile[] = [];
      for (const entry of yield* fileSystem.readDirectory(directory, { recursive: true })) {
        const info = yield* fileSystem.stat(path.join(directory, entry));
        if (info.type !== "File") continue;
        files.push({
          path: `${folder}/${entry.split(path.sep).join("/")}`,
          sizeBytes: Number(info.size),
          modifiedAt: Option.getOrNull(info.mtime),
        });
      }
      return files;
    },
    Effect.mapError((cause) => new DeliverableBlobStoreError({ operation: "sweep", cause })),
  );

  const listRenditionFolders: DeliverableBlobStore["Service"]["listRenditionFolders"] = Effect.gen(
    function* () {
      const directory = path.join(root, "renditions");
      if (!(yield* fileSystem.exists(directory))) return [];
      const folders: Array<{ readonly sha256: string; readonly kind: string }> = [];
      for (const sha256 of yield* fileSystem.readDirectory(directory)) {
        const kinds = yield* fileSystem.readDirectory(path.join(directory, sha256));
        // A folder with no kind in it is listed as such, so it can be removed.
        for (const kind of kinds.length === 0 ? [""] : kinds) folders.push({ sha256, kind });
      }
      return folders;
    },
  ).pipe(
    Effect.mapError((cause) => new DeliverableBlobStoreError({ operation: "sweep", cause })),
    Effect.withSpan("DeliverableBlobStore.listRenditionFolders"),
  );

  const remove: DeliverableBlobStore["Service"]["remove"] = Effect.fn(
    "DeliverableBlobStore.remove",
  )(
    function* (relativePath) {
      const target = path.resolve(root, ...relativePath.split("/"));
      const inside = path.relative(root, target);
      if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) {
        return yield* Effect.die(new TypeError("Not a path inside the deliverable store."));
      }
      yield* fileSystem.remove(target, { recursive: true, force: true });
    },
    Effect.mapError((cause) => new DeliverableBlobStoreError({ operation: "sweep", cause })),
  );

  return DeliverableBlobStore.of({
    root,
    whileWriting: writers.withPermits(1),
    whileCleaning: writers.withPermits(WRITER_PLACES),
    listFiles,
    listRenditionFolders,
    remove,
    ingest,
    blobPath,
    hash: Effect.fn("DeliverableBlobStore.hash")(
      (file: string) => hashFile(file),
      Effect.mapError((cause) => new DeliverableBlobStoreError({ operation: "hash", cause })),
    ),
    has,
    materialize,
    renditionDir: ({ sha256, kind }) => path.join(root, "renditions", sha256, kind),
    scratchDir,
    usage,
  });
});

export const layer = Layer.effect(DeliverableBlobStore, make);
