// @effect-diagnostics nodeBuiltinImport:off - effect's Digest hashes one buffer; media must stream.
import * as NodeCrypto from "node:crypto";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as ServerConfig from "../config.ts";

export class DeliverableBlobStoreError extends Schema.TaggedError<DeliverableBlobStoreError>()(
  "DeliverableBlobStoreError",
  {
    operation: Schema.Literals(["ingest", "hash", "materialize", "stage", "usage"]),
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

/**
 * Content-addressed bytes under `<userdata>/deliverables`. Blobs use Git LFS's object layout
 * (`objects/ab/cd/<sha256>`), so `lfs.storage` can point at this directory. Nothing is deleted
 * automatically; `usage` is the hook a retention policy would start from.
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
  }
>()("t3/deliverables/DeliverableBlobStore") {}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const root = path.join(config.stateDir, "deliverables");
  const objectsDir = path.join(root, "objects");
  const scratchRoot = path.join(root, "tmp");

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

  return DeliverableBlobStore.of({
    root,
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
