import { CheckpointRef } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as DeliverableRepository from "../persistence/Deliverables.ts";
import { HIDDEN_REFS_ROOT } from "../vcs/hiddenRefs.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  encodeBlobPointer,
  MAX_POINTER_BYTES,
  parseBlobPointer,
  storesAsPointer,
} from "./blobPointer.ts";
import * as DeliverableBlobStore from "./DeliverableBlobStore.ts";

export const DELIVERABLE_REFS_ROOT = `${HIDDEN_REFS_ROOT}/deliverables`;

export class DeliverableGitError extends Schema.TaggedError<DeliverableGitError>()(
  "DeliverableGitError",
  {
    operation: Schema.Literals(["init", "snapshot", "capture", "restore", "read", "refs"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Deliverable Git ${this.operation} failed.`;
  }
}

export class DeliverableWorkspaceChangedError extends Schema.TaggedError<DeliverableWorkspaceChangedError>()(
  "DeliverableWorkspaceChangedError",
  { changedPaths: Schema.Number },
) {
  override get message(): string {
    return `${this.changedPaths} file(s) changed since the current version.`;
  }
}

interface TreeEntry {
  readonly mode: string;
  readonly type: string;
  readonly oid: string;
  readonly size: number;
  readonly path: string;
}

const isDeliverableGitError = Schema.is(DeliverableGitError);
const isWorkspaceChangedError = Schema.is(DeliverableWorkspaceChangedError);

export interface SnapshotResult {
  readonly commitOid: string;
  /** Git blob id and stored content of every file the snapshot keeps as a pointer. */
  readonly media: ReadonlyMap<
    string,
    { readonly gitBlobOid: string; readonly sha256: string; readonly sizeBytes: number }
  >;
}

/**
 * Deliverable versions as Git commits. Each version snapshots the whole project; media and large
 * files become Git LFS pointers whose bytes live in the blob store, so version history never
 * carries them. Version commits chain through their parent versions, so forks after an undo are
 * real Git branches of the version graph, kept alive by refs under DELIVERABLE_REFS_ROOT.
 */
export class DeliverableGit extends Context.Service<
  DeliverableGit,
  {
    /** Makes the workspace a Git repository when it is not one, for projects with no checkpoints. */
    readonly ensureRepository: (cwd: string) => Effect.Effect<void, DeliverableGitError>;
    readonly resolveCommit: (input: {
      readonly cwd: string;
      readonly rev: string;
    }) => Effect.Effect<string | null, DeliverableGitError>;
    /** Captures the working tree, as a turn's checkpoint would, and returns its commit. */
    readonly captureWorkingTree: (
      cwd: string,
    ) => Effect.Effect<
      { readonly commitOid: string; readonly release: Effect.Effect<void> },
      DeliverableGitError
    >;
    /** Paths that differ between two commits (or every path when `from` is null). */
    readonly changedPaths: (input: {
      readonly cwd: string;
      readonly from: string | null;
      readonly to: string;
    }) => Effect.Effect<ReadonlyArray<string>, DeliverableGitError>;
    /** The blob id of one path in a commit, or null when the commit has no such file. */
    readonly blobAt: (input: {
      readonly cwd: string;
      readonly commit: string;
      readonly path: string;
    }) => Effect.Effect<string | null, DeliverableGitError>;
    readonly snapshot: (input: {
      readonly cwd: string;
      readonly sourceCommit: string;
      readonly parentCommit: string | null;
      readonly message: string;
      readonly ref: string;
    }) => Effect.Effect<SnapshotResult, DeliverableGitError>;
    /**
     * Content hashes of every stored file a version commit points at. Fails unless every file in
     * the commit could be inspected, so a result is always the whole list.
     */
    readonly storedBlobs: (input: {
      readonly cwd: string;
      readonly commit: string;
    }) => Effect.Effect<ReadonlyArray<string>, DeliverableGitError>;
    /**
     * Deletes version refs, so Git can drop the commits of versions that no longer exist. Succeeds
     * only once Git no longer lists them; a folder that is not a reachable repository fails.
     */
    readonly deleteRefs: (input: {
      readonly cwd: string;
      readonly refs: ReadonlyArray<string>;
    }) => Effect.Effect<void, DeliverableGitError>;
    /**
     * Rewrites the workspace paths that differ between two version commits to match `to`.
     * Refuses when any of them no longer matches `from`.
     */
    readonly restore: (input: {
      readonly cwd: string;
      readonly from: string;
      readonly to: string;
    }) => Effect.Effect<
      ReadonlyArray<string>,
      DeliverableGitError | DeliverableWorkspaceChangedError
    >;
  }
>()("t3/deliverables/DeliverableGit") {}

const AUTHOR_ENV = {
  GIT_AUTHOR_NAME: "Deliverable versions",
  GIT_AUTHOR_EMAIL: "deliverables@localhost",
  GIT_COMMITTER_NAME: "Deliverable versions",
  GIT_COMMITTER_EMAIL: "deliverables@localhost",
};
const LIST_OUTPUT_BYTES = 64 * 1024 * 1024;

function parseTree(output: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  for (const record of output.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const [mode, type, oid, size] = record.slice(0, tab).split(/\s+/);
    entries.push({
      mode: mode!,
      type: type!,
      oid: oid!,
      size: Number(size),
      path: record.slice(tab + 1),
    });
  }
  return entries;
}

const make = Effect.gen(function* () {
  const vcs = yield* VcsProcess.VcsProcess;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const checkpoints = yield* CheckpointStore.CheckpointStore;
  const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;
  const repository = yield* DeliverableRepository.DeliverableRepository;

  const git = (
    operation: string,
    cwd: string,
    args: ReadonlyArray<string>,
    options: {
      readonly env?: NodeJS.ProcessEnv;
      readonly stdin?: string;
      readonly allowNonZeroExit?: boolean;
    } = {},
  ) =>
    vcs.run({
      operation: `DeliverableGit.${operation}`,
      command: "git",
      cwd,
      args,
      maxOutputBytes: LIST_OUTPUT_BYTES,
      outputMode: "error",
      timeoutMs: 120_000,
      ...options,
    });

  /** A scratch index in the store, so the user's index is never touched. */
  const withIndex = <A, E, R>(
    use: (env: NodeJS.ProcessEnv, scratch: string) => Effect.Effect<A, E, R>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const scratch = yield* blobs.scratchDir;
        return yield* use({ ...AUTHOR_ENV, GIT_INDEX_FILE: path.join(scratch, "index") }, scratch);
      }),
    );

  const ensureRepository: DeliverableGit["Service"]["ensureRepository"] = Effect.fn(
    "DeliverableGit.ensureRepository",
  )(
    function* (cwd) {
      if (yield* checkpoints.isGitRepository(cwd)) return;
      yield* git("init", cwd, ["init"]);
    },
    Effect.mapError((cause) => new DeliverableGitError({ operation: "init", cause })),
  );

  const resolveCommit: DeliverableGit["Service"]["resolveCommit"] = Effect.fn(
    "DeliverableGit.resolveCommit",
  )(
    function* (input) {
      const result = yield* git(
        "resolveCommit",
        input.cwd,
        ["rev-parse", "--verify", "--quiet", `${input.rev}^{commit}`],
        {
          allowNonZeroExit: true,
        },
      );
      const oid = result.stdout.trim();
      return result.exitCode === 0 && oid !== "" ? oid : null;
    },
    Effect.mapError((cause) => new DeliverableGitError({ operation: "read", cause })),
  );

  const captureWorkingTree: DeliverableGit["Service"]["captureWorkingTree"] = Effect.fn(
    "DeliverableGit.captureWorkingTree",
  )(
    function* (cwd) {
      const ref = CheckpointRef.make(`${DELIVERABLE_REFS_ROOT}/capture/${yield* random.uuidV4()}`);
      yield* checkpoints.captureCheckpoint({ cwd, checkpointRef: ref });
      const release = checkpoints
        .deleteCheckpointRefs({ cwd, checkpointRefs: [ref] })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not delete a capture ref", { error: error.message }),
          ),
        );
      const commitOid = yield* resolveCommit({ cwd, rev: ref }).pipe(
        Effect.tapError(() => release),
      );
      if (commitOid === null) {
        yield* release;
        return yield* Effect.die("The capture ref did not resolve to a commit.");
      }
      return { commitOid, release };
    },
    Effect.mapError((cause) =>
      isDeliverableGitError(cause)
        ? cause
        : new DeliverableGitError({ operation: "capture", cause }),
    ),
  );

  const changedPaths: DeliverableGit["Service"]["changedPaths"] = Effect.fn(
    "DeliverableGit.changedPaths",
  )(
    function* (input) {
      const result =
        input.from === null
          ? yield* git("changedPaths", input.cwd, ["ls-tree", "-r", "--name-only", "-z", input.to])
          : yield* git("changedPaths", input.cwd, [
              "diff-tree",
              "-r",
              "--no-renames",
              "--name-only",
              "-z",
              input.from,
              input.to,
            ]);
      return result.stdout.split("\0").filter((entry) => entry !== "");
    },
    Effect.mapError((cause) => new DeliverableGitError({ operation: "read", cause })),
  );

  const blobAt: DeliverableGit["Service"]["blobAt"] = Effect.fn("DeliverableGit.blobAt")(
    function* (input) {
      const result = yield* git("blobAt", input.cwd, [
        "ls-tree",
        "-z",
        input.commit,
        "--",
        input.path,
      ]);
      const entry = parseTree(result.stdout).find((candidate) => candidate.path === input.path);
      return entry?.type === "blob" ? entry.oid : null;
    },
    Effect.mapError((cause) => new DeliverableGitError({ operation: "read", cause })),
  );

  /** Stores the bytes of tree entries the blob index does not know yet, read through a scratch index. */
  const storeMedia = Effect.fn("DeliverableGit.storeMedia")(function* (
    cwd: string,
    sourceCommit: string,
    entries: ReadonlyArray<TreeEntry>,
  ) {
    const indexed = yield* repository.lookupBlobs([...new Set(entries.map((entry) => entry.oid))]);
    // The index is only a shortcut: bytes that are not in the store are read out of Git again.
    const stored = new Map<string, string>();
    for (const [oid, sha256] of indexed) {
      if (yield* blobs.has(sha256)) stored.set(oid, sha256);
      else yield* repository.forgetBlob(sha256);
    }
    const missing = entries.filter((entry) => !stored.has(entry.oid));
    if (missing.length > 0) {
      yield* withIndex((env, scratch) =>
        Effect.gen(function* () {
          // Git takes the prefix literally; forward slashes work on every platform.
          const prefix = `${path.join(scratch, "files").replaceAll("\\", "/")}/`;
          yield* git("readTree", cwd, ["read-tree", sourceCommit], { env });
          yield* git(
            "checkoutIndex",
            cwd,
            ["checkout-index", "-f", "-z", "--stdin", `--prefix=${prefix}`],
            {
              env,
              stdin: missing.map((entry) => `${entry.path}\0`).join(""),
            },
          );
          for (const entry of missing) {
            if (stored.has(entry.oid)) continue;
            const blob = yield* blobs.ingest({ path: path.join(prefix, entry.path), move: true });
            yield* repository.recordBlob({
              gitBlobOid: entry.oid,
              contentSha256: blob.sha256,
              sizeBytes: blob.sizeBytes,
            });
            stored.set(entry.oid, blob.sha256);
          }
        }),
      );
    }
    return stored;
  });

  const snapshot: DeliverableGit["Service"]["snapshot"] = Effect.fn("DeliverableGit.snapshot")(
    function* (input) {
      const tree = parseTree(
        (yield* git("lsTree", input.cwd, ["ls-tree", "-r", "-l", "-z", input.sourceCommit])).stdout,
      );
      const media = tree.filter(
        (entry) =>
          entry.type === "blob" &&
          entry.mode !== "120000" &&
          storesAsPointer(entry.path, entry.size),
      );
      const shas = yield* storeMedia(input.cwd, input.sourceCommit, media);
      const result = new Map<string, { gitBlobOid: string; sha256: string; sizeBytes: number }>();
      const commitOid = yield* withIndex((env, scratch) =>
        Effect.gen(function* () {
          yield* git("readTree", input.cwd, ["read-tree", input.sourceCommit], { env });
          const pointerDir = path.join(scratch, "pointers");
          yield* fileSystem.makeDirectory(pointerDir, { recursive: true });
          const pointerFiles: string[] = [];
          for (const [index, entry] of media.entries()) {
            const sha256 = shas.get(entry.oid)!;
            const file = path.join(pointerDir, String(index));
            yield* fileSystem.writeFileString(
              file,
              encodeBlobPointer({ oid: sha256, size: entry.size }),
            );
            pointerFiles.push(file);
            result.set(entry.path, { gitBlobOid: entry.oid, sha256, sizeBytes: entry.size });
          }
          if (media.length > 0) {
            const hashed = yield* git(
              "hashPointers",
              input.cwd,
              ["hash-object", "-w", "--no-filters", "--stdin-paths"],
              {
                stdin: `${pointerFiles.join("\n")}\n`,
              },
            );
            const oids = hashed.stdout.trim().split("\n");
            yield* git("updateIndex", input.cwd, ["update-index", "-z", "--index-info"], {
              env,
              stdin: media
                .map((entry, index) => `${entry.mode} ${oids[index]}\t${entry.path}\0`)
                .join(""),
            });
          }
          const treeOid = (yield* git("writeTree", input.cwd, ["write-tree"], {
            env,
          })).stdout.trim();
          const commit = (yield* git(
            "commitTree",
            input.cwd,
            [
              "commit-tree",
              treeOid,
              ...(input.parentCommit === null ? [] : ["-p", input.parentCommit]),
              "-m",
              input.message,
            ],
            { env },
          )).stdout.trim();
          yield* git("updateRef", input.cwd, ["update-ref", input.ref, commit], { env });
          return commit;
        }),
      );
      return { commitOid, media: result } satisfies SnapshotResult;
    },
    Effect.mapError((cause) =>
      isDeliverableGitError(cause)
        ? cause
        : new DeliverableGitError({ operation: "snapshot", cause }),
    ),
  );

  /**
   * Pointer contents of the small blobs among `oids`; other blobs are absent from the map. Git
   * answers "missing" for an object it has lost without failing, so every oid must come back as
   * a blob with a size: an object that could not be looked at is not one without a pointer.
   */
  const readPointers = Effect.fn("DeliverableGit.readPointers")(function* (
    cwd: string,
    oids: ReadonlyArray<string>,
  ) {
    const pointers = new Map<string, { readonly oid: string; readonly size: number }>();
    if (oids.length === 0) return pointers;
    const checked = yield* git("batchCheck", cwd, ["cat-file", "--batch-check"], {
      stdin: `${oids.join("\n")}\n`,
    });
    const sizes = new Map<string, number>();
    for (const line of checked.stdout.split("\n")) {
      const [oid, type, size] = line.split(" ");
      if (oid !== undefined && type === "blob" && /^\d+$/.test(size ?? "")) {
        sizes.set(oid, Number(size));
      }
    }
    const unread = oids.filter((oid) => !sizes.has(oid));
    if (unread.length > 0) {
      return yield* new DeliverableGitError({
        operation: "read",
        cause: `Git could not read ${unread.length} of ${oids.length} files, such as ${unread[0]}.`,
      });
    }
    const small = oids.filter((oid) => sizes.get(oid)! <= MAX_POINTER_BYTES);
    for (const oid of small) {
      const text = (yield* git("readPointer", cwd, ["cat-file", "blob", oid])).stdout;
      const pointer = parseBlobPointer(text);
      if (pointer !== null) pointers.set(oid, pointer);
    }
    return pointers;
  });

  const storedBlobs: DeliverableGit["Service"]["storedBlobs"] = Effect.fn(
    "DeliverableGit.storedBlobs",
  )(
    function* (input) {
      const files = parseTree(
        (yield* git("lsTree", input.cwd, ["ls-tree", "-r", "-l", "-z", input.commit])).stdout,
      ).filter((entry) => entry.type === "blob");
      // Git prints a size it could not get as "BAD" and still exits 0.
      const unsized = files.filter((entry) => !Number.isInteger(entry.size));
      if (unsized.length > 0) {
        return yield* new DeliverableGitError({
          operation: "read",
          cause: `Git could not size ${unsized.length} files of the commit, such as ${unsized[0]!.path}.`,
        });
      }
      const pointers = yield* readPointers(input.cwd, [
        ...new Set(
          files.filter((entry) => entry.size <= MAX_POINTER_BYTES).map((entry) => entry.oid),
        ),
      ]);
      return [...new Set([...pointers.values()].map((pointer) => pointer.oid))];
    },
    Effect.mapError((cause) =>
      isDeliverableGitError(cause) ? cause : new DeliverableGitError({ operation: "read", cause }),
    ),
  );

  const deleteRefs: DeliverableGit["Service"]["deleteRefs"] = Effect.fn(
    "DeliverableGit.deleteRefs",
  )(
    function* (input) {
      if (input.refs.length === 0) return;
      if (!(yield* checkpoints.isGitRepository(input.cwd))) {
        return yield* new DeliverableGitError({
          operation: "refs",
          cause: "The project folder is not a reachable Git repository.",
        });
      }
      yield* checkpoints.deleteCheckpointRefs({
        cwd: input.cwd,
        checkpointRefs: input.refs.map((ref) => CheckpointRef.make(ref)),
      });
      const listed = new Set(
        (yield* git("listRefs", input.cwd, [
          "for-each-ref",
          "--format=%(refname)",
          DELIVERABLE_REFS_ROOT,
        ])).stdout.split("\n"),
      );
      const left = input.refs.filter((ref) => listed.has(ref));
      if (left.length > 0) {
        return yield* new DeliverableGitError({
          operation: "refs",
          cause: `Git still lists ${left.length} of the refs, such as ${left[0]}.`,
        });
      }
    },
    Effect.mapError((cause) =>
      isDeliverableGitError(cause) ? cause : new DeliverableGitError({ operation: "refs", cause }),
    ),
  );

  const restore: DeliverableGit["Service"]["restore"] = Effect.fn("DeliverableGit.restore")(
    function* (input) {
      const diff = (yield* git("diffTree", input.cwd, [
        "diff-tree",
        "-r",
        "--no-renames",
        "-z",
        input.from,
        input.to,
      ])).stdout.split("\0");
      const changes: Array<{
        readonly path: string;
        readonly fromOid: string | null;
        readonly toOid: string | null;
      }> = [];
      for (let i = 0; i + 1 < diff.length; i += 2) {
        const header = diff[i]!;
        if (!header.startsWith(":")) break;
        const [, , fromOid, toOid] = header.slice(1).split(" ");
        const absent = (oid: string | undefined) =>
          oid === undefined || /^0+$/.test(oid) ? null : oid;
        changes.push({ path: diff[i + 1]!, fromOid: absent(fromOid), toOid: absent(toOid) });
      }
      const pointers = yield* readPointers(input.cwd, [
        ...new Set(
          changes.flatMap((change) => [change.fromOid, change.toOid]).filter((oid) => oid !== null),
        ),
      ]);

      // A workspace file may match either side: the old version (about to be replaced) or the
      // target (already restored, as after an interrupted restore). Anything else is user work.
      const matches = Effect.fn("DeliverableGit.matches")(function* (
        file: string,
        oid: string | null,
      ) {
        const exists = yield* fileSystem.exists(file);
        if (oid === null) return !exists;
        if (!exists) return false;
        const pointer = pointers.get(oid);
        if (pointer !== undefined) return (yield* blobs.hash(file)).sha256 === pointer.oid;
        const hashed = yield* git("hashFile", input.cwd, ["hash-object", "--", file]);
        return hashed.stdout.trim() === oid;
      });
      let conflicts = 0;
      const pending: typeof changes = [];
      for (const change of changes) {
        const file = path.join(input.cwd, change.path);
        if (yield* matches(file, change.toOid)) continue;
        if (!(yield* matches(file, change.fromOid))) conflicts += 1;
        pending.push(change);
      }
      if (conflicts > 0)
        return yield* new DeliverableWorkspaceChangedError({ changedPaths: conflicts });

      const fromGit = pending.filter(
        (change) => change.toOid !== null && !pointers.has(change.toOid),
      );
      if (fromGit.length > 0) {
        yield* withIndex((env) =>
          Effect.gen(function* () {
            yield* git("readTree", input.cwd, ["read-tree", input.to], { env });
            yield* git("checkoutIndex", input.cwd, ["checkout-index", "-f", "-z", "--stdin"], {
              env,
              stdin: fromGit.map((change) => `${change.path}\0`).join(""),
            });
          }),
        );
      }
      for (const change of pending) {
        const file = path.join(input.cwd, change.path);
        if (change.toOid === null) {
          yield* fileSystem.remove(file, { force: true });
          continue;
        }
        const pointer = pointers.get(change.toOid);
        if (pointer !== undefined)
          yield* blobs.materialize({ sha256: pointer.oid, destination: file });
      }
      return pending.map((change) => change.path);
    },
    Effect.mapError((cause) =>
      isDeliverableGitError(cause) || isWorkspaceChangedError(cause)
        ? cause
        : new DeliverableGitError({ operation: "restore", cause }),
    ),
  );

  return DeliverableGit.of({
    ensureRepository,
    resolveCommit,
    captureWorkingTree,
    changedPaths,
    blobAt,
    snapshot,
    storedBlobs,
    deleteRefs,
    restore,
  });
});

export const layer = Layer.effect(DeliverableGit, make);
