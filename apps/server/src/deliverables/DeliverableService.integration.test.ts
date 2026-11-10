// @effect-diagnostics nodeBuiltinImport:off - the fake renderer hashes fixture lines.
import * as NodeCrypto from "node:crypto";

import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  MessageId,
  NodeId,
  type OrchestrationV2Checkpoint,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as AssetSigner from "../assets/AssetSigner.ts";
import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as DeliverableNoteRepository from "../persistence/DeliverableNotes.ts";
import * as DeliverableRepository from "../persistence/Deliverables.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { parseBlobPointer } from "./blobPointer.ts";
import * as DeliverableBlobStore from "./DeliverableBlobStore.ts";
import * as DeliverableComparer from "./DeliverableComparer.ts";
import * as DeliverableContext from "./DeliverableContext.ts";
import * as DeliverableGit from "./DeliverableGit.ts";
import * as DeliverableRenderers from "./DeliverableRenderers.ts";
import * as DeliverableRenditions from "./DeliverableRenditions.ts";
import * as DeliverableSelfCheck from "./DeliverableSelfCheck.ts";
import * as DeliverableStoreCleanup from "./DeliverableStoreCleanup.ts";
import { frameRegion, OUTLINE_GRID, VIDEO_GRID } from "./perceptualDiff.ts";

const TURN_REPLY =
  "## **Made the title slide bolder** in [the deck](C:/work/deck.pptx)\n\nDetails follow.";
import * as DeliverableNotes from "./DeliverableNotes.ts";
import * as DeliverableService from "./DeliverableService.ts";
import * as WorkProjectEvents from "./WorkProjectEvents.ts";
import * as DeliverableTurnNotes from "./DeliverableTurnNotes.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as TurnContextNotes from "../orchestration-v2/TurnContextNotes.ts";

const projectId = ProjectId.make("project-work");
const threadId = ThreadId.make("thread-work");

const rendererCalls = { sampleFrames: 0, readImage: 0, outlineImage: 0 };
/** How the stand-in renderer behaves; a test sets it and puts it back. */
const rendering: {
  mode: "works" | "crashes" | "hangs";
  /** Completed when a render that hangs has begun. */
  hung: Deferred.Deferred<void> | null;
} = { mode: "works", hung: null };

/** A dark raster with a white bar across its top, `length` pixels wide. */
const barRaster = (side: number, length: number) => {
  const data = new Uint8Array(side * side * 3).fill(30);
  for (let y = 0; y < 8; y++) data.fill(255, y * side * 3, (y * side + length) * 3);
  return { width: side, height: side, data };
};

/**
 * Stands in for PowerPoint and ffmpeg, working on text files. A deck is one slide a line, compared
 * by hash. An image's display file holds its trimmed text and every image shares one outline, so
 * only `readImage`, which draws a bar as long as the text, can tell two apart. A video and a PDF
 * render as older servers did, with samples and outlines the comparison has to redo first.
 */
const layerLineRenderer = Layer.effect(
  DeliverableRenderers.DeliverableRenderers,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const base = {
      renderer: "test-lines@1",
      width: null,
      height: null,
      durationSeconds: null,
      poster: null,
      proxy: null,
      samples: null,
      detail: null,
    };
    return DeliverableRenderers.DeliverableRenderers.of({
      render: (input) =>
        Effect.gen(function* () {
          if (rendering.mode === "crashes") throw new Error("The renderer fell over.");
          if (rendering.mode === "hangs") {
            if (rendering.hung !== null) yield* Deferred.succeed(rendering.hung, undefined);
            return yield* Effect.never;
          }
          const text = yield* fileSystem.readFileString(input.sourcePath);
          yield* fileSystem.makeDirectory(input.outDir, { recursive: true });
          const write = (file: string, bytes: Uint8Array) =>
            fileSystem.writeFile(path.join(input.outDir, file), bytes);
          if (input.kind === "image") {
            yield* write("image-0001.jpg", new TextEncoder().encode(text.trim()));
            yield* write("image-0001.rgb", new Uint8Array(OUTLINE_GRID * OUTLINE_GRID * 3));
            return {
              ...base,
              units: [
                {
                  index: 0,
                  kind: "image" as const,
                  image: "image-0001.jpg",
                  thumb: null,
                  signature: { file: "image-0001.rgb", grid: OUTLINE_GRID },
                },
              ],
            };
          }
          if (input.kind === "pdf") {
            yield* write("page-0001.jpg", new TextEncoder().encode(text.trim()));
            yield* write("page-0001.rgb", new Uint8Array(32 * 32 * 3));
            return {
              ...base,
              units: [
                {
                  index: 0,
                  kind: "page" as const,
                  image: "page-0001.jpg",
                  thumb: null,
                  signature: { file: "page-0001.rgb" },
                },
              ],
            };
          }
          if (input.kind === "video") {
            yield* write("samples.rgb", new Uint8Array(32 * 32 * 3));
            return {
              ...base,
              durationSeconds: 1,
              samples: { file: "samples.rgb", fps: 1 },
              units: [
                {
                  index: 0,
                  kind: "shot" as const,
                  start: 0,
                  end: 1,
                  image: null,
                  thumb: null,
                  signature: null,
                },
              ],
            };
          }
          return {
            ...base,
            units: text.split("\n").map((line, index) => ({
              index,
              kind: "slide" as const,
              image: null,
              thumb: null,
              signature: { hash: NodeCrypto.createHash("sha256").update(line).digest("hex") },
            })),
          };
        }).pipe(Effect.orDie),
      sampleFrames: (input) =>
        Effect.gen(function* () {
          rendererCalls.sampleFrames++;
          const text = yield* fileSystem.readFileString(input.sourcePath);
          const file = `frames-${VIDEO_GRID}.rgb`;
          yield* fileSystem.writeFile(
            path.join(input.outDir, file),
            barRaster(VIDEO_GRID, text.length).data,
          );
          return { file, fps: 1, grid: VIDEO_GRID };
        }).pipe(Effect.orDie),
      outlineImage: (input) =>
        Effect.gen(function* () {
          rendererCalls.outlineImage++;
          yield* fileSystem.writeFile(
            input.outlinePath,
            new Uint8Array(OUTLINE_GRID * OUTLINE_GRID * 3),
          );
        }).pipe(Effect.orDie),
      readImage: (input) =>
        Effect.gen(function* () {
          rendererCalls.readImage++;
          return barRaster(96, (yield* fileSystem.readFileString(input.imagePath)).length);
        }).pipe(Effect.orDie),
    });
  }),
);

const setup = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcs = yield* VcsProcess.VcsProcess;
  const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "deliverables-it-" });
  const git = (...args: ReadonlyArray<string>) =>
    vcs
      .run({ operation: "test.git", command: "git", cwd: root, args })
      .pipe(Effect.map((result) => result.stdout.trim()));
  const write = (relative: string, text: string) =>
    fileSystem
      .makeDirectory(path.dirname(path.join(root, relative)), { recursive: true })
      .pipe(Effect.andThen(fileSystem.writeFileString(path.join(root, relative), text)));
  const read = (relative: string) => fileSystem.readFileString(path.join(root, relative));
  yield* git("init", "--initial-branch=main");
  yield* git("config", "user.email", "test@example.com");
  yield* git("config", "user.name", "Test");
  yield* write("README.md", "work\n");
  yield* git("add", ".");
  yield* git("commit", "-m", "init");
  return { root, git, write, read };
});

const busy = { value: false };
/** Projects the engine is told were deleted, or could not be read just now. */
const projects = { deleted: new Set<ProjectId>(), unreadable: false };
const otherProjectId = ProjectId.make("project-other");
const layerContext = (root: string) =>
  Layer.succeed(
    DeliverableContext.DeliverableContext,
    DeliverableContext.DeliverableContext.of({
      projectRoot: (id) =>
        Effect.sync(() =>
          (id === projectId || id === otherProjectId) && !projects.deleted.has(id) ? root : null,
        ),
      projectState: (id) =>
        Effect.sync((): DeliverableContext.ProjectState =>
          projects.unreadable
            ? { type: "unknown" }
            : id !== projectId && id !== otherProjectId
              ? { type: "missing" }
              : { type: projects.deleted.has(id) ? "deleted" : "active", workspaceRoot: root },
        ),
      turn: () =>
        Effect.succeed({
          projectId,
          cwd: root,
          reply: TURN_REPLY,
          parentCheckpointRef: null,
        }),
      projectBusy: () => Effect.sync(() => busy.value),
    }),
  );

const layerPlatform = Layer.mergeAll(NodeServices.layer, NodeCryptoLayer.layer);
const layerVcsProcess = VcsProcess.layer.pipe(Layer.provide(layerPlatform));
const layerEngine = (root: string, deadline: Duration.Duration) =>
  DeliverableService.layer.pipe(
    Layer.provideMerge(DeliverableNotes.layer),
    Layer.provideMerge(Layer.mergeAll(DeliverableComparer.layer, DeliverableStoreCleanup.layer)),
    Layer.provideMerge(DeliverableRenditions.layerWith({ deadline })),
    Layer.provideMerge(
      Layer.mergeAll(
        DeliverableGit.layer,
        layerLineRenderer,
        DeliverableSelfCheck.layer,
        layerContext(root),
      ),
    ),
    Layer.provideMerge(
      CheckpointStore.layer.pipe(
        Layer.provide(VcsDriverRegistry.layer.pipe(Layer.provide(layerVcsProcess))),
      ),
    ),
    Layer.provideMerge(DeliverableBlobStore.layer),
    Layer.provideMerge(WorkProjectEvents.layer),
    Layer.provideMerge(
      Layer.mergeAll(DeliverableRepository.layer, DeliverableNoteRepository.layer).pipe(
        Layer.provideMerge(SqlitePersistence.layerMemory),
      ),
    ),
    Layer.provide(Layer.mock(AssetSigner.AssetSigner)({ sign: () => Effect.succeed("signature") })),
    Layer.provideMerge(
      ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "deliverables-it-state-" }),
    ),
    Layer.provideMerge(layerVcsProcess),
    Layer.provideMerge(layerPlatform),
  );

const checkpoint = (ordinal: number, ref: CheckpointRef): OrchestrationV2Checkpoint => ({
  id: CheckpointId.make(`checkpoint-${ordinal}`),
  threadId,
  scopeId: CheckpointScopeId.make("scope-root"),
  runId: RunId.make(`run-${ordinal}`),
  nodeId: NodeId.make(`node-${ordinal}`),
  parentCheckpointId: null,
  ordinalWithinScope: ordinal,
  appRunOrdinal: ordinal,
  ref,
  status: "ready",
  files: [
    { path: "deck.pptx", kind: "modified", additions: 1, deletions: 1 },
    { path: "src/slides.ts", kind: "modified", additions: 1, deletions: 1 },
  ],
  capturedAt: DateTime.makeUnsafe("2026-11-09T00:00:00Z"),
});

const withEngine = <A, E>(
  body: (
    repo: Effect.Success<typeof setup>,
  ) => Effect.Effect<A, E, Layer.Success<ReturnType<typeof layerEngine>>>,
  options: { readonly renderDeadline?: Duration.Duration } = {},
) =>
  Effect.gen(function* () {
    const repo = yield* setup;
    return yield* body(repo).pipe(
      Effect.provide(layerEngine(repo.root, options.renderDeadline ?? Duration.minutes(30))),
      Effect.ensuring(
        Effect.sync(() => {
          rendering.mode = "works";
          rendering.hung = null;
          projects.deleted.clear();
          projects.unreadable = false;
        }),
      ),
    );
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(layerPlatform, layerVcsProcess)));

it.live(
  "records each turn's changed deck as a Git commit with the deck as a pointer to the blob store",
  () =>
    withEngine((repo) =>
      Effect.gen(function* () {
        const deliverables = yield* DeliverableService.DeliverableService;
        const checkpoints = yield* CheckpointStore.CheckpointStore;
        const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;

        const turn = Effect.fn("test.turn")(function* (
          ordinal: number,
          deck: string,
          source: string,
        ) {
          yield* repo.write("deck.pptx", deck);
          yield* repo.write("src/slides.ts", source);
          const ref = CheckpointRef.make(`refs/t3/test-checkpoints/${ordinal}`);
          yield* checkpoints.captureCheckpoint({ cwd: repo.root, checkpointRef: ref });
          return yield* deliverables.detectFromCheckpoint({
            threadId,
            checkpoint: checkpoint(ordinal, ref),
          });
        });

        const [v1] = yield* turn(1, "Title\nAgenda\nClose", "export const v = 1;\n");
        const [v2] = yield* turn(2, "Title\nAgenda v2\nClose", "export const v = 2;\n");
        assert.isDefined(v1);
        assert.isDefined(v2);
        assert.equal(v1.summary, "Made the title slide bolder in the deck");
        assert.equal(v1.summaryDetail, TURN_REPLY);
        // An unchanged deck records nothing, even when the turn touched other files.
        assert.deepEqual(yield* turn(3, "Title\nAgenda v2\nClose", "export const v = 3;\n"), []);
        yield* repo.write("src/slides.ts", "export const v = 2;\n");

        const unchanged = yield* deliverables.registerVersion({ projectId, path: "deck.pptx" });
        assert.isFalse(unchanged.created);
        assert.equal(unchanged.version.id, v2.id);

        yield* repo.write("deck.pptx", "Title\nAgenda v2\nClose\nThanks");
        const third = (yield* deliverables.registerVersion({
          projectId,
          path: "deck.pptx",
          summary: "Added a closing slide",
          expectedChanges: [{ kind: "slide", index: 3 }],
        })).version;
        assert.equal(third.ordinal, 3);
        assert.equal(third.parentVersionId, v2.id);

        yield* deliverables.drain;
        const comparison = yield* deliverables.compare({ targetVersionId: v2.id });
        assert.equal(comparison.method, "structural");
        assert.deepEqual(
          comparison.units.map((unit) => unit.status),
          ["unchanged", "changed", "unchanged"],
        );
        assert.equal(comparison.summary, "Made the title slide bolder in the deck");
        assert.equal(comparison.headline, "1 slide changed");

        const { versions } = yield* deliverables.versions(v1.deliverableId);
        const checked = versions.find((version) => version.id === third.id);
        assert.equal(checked?.selfCheck?.status, "passed");

        // Each version is a commit chained to its parent, with the deck as an LFS pointer.
        const pointerText = yield* repo.git("show", `${v2.commitOid}:deck.pptx`);
        assert.equal(parseBlobPointer(`${pointerText}\n`)?.oid, v2.contentSha256);
        assert.equal(
          yield* repo.git("show", `${v2.commitOid}:src/slides.ts`),
          "export const v = 2;",
        );
        assert.equal(yield* repo.git("rev-parse", `${v2.commitOid}^`), v1.commitOid);
        assert.equal(yield* repo.git("rev-parse", v2.ref), v2.commitOid);
        assert.isTrue(yield* blobs.has(v2.contentSha256));
        assert.equal(yield* repo.git("rev-list", "--count", "main"), "1");
      }),
    ),
);

it.live("undoes, redoes and forks versions by rewriting the workspace, never deleting one", () =>
  withEngine((repo) =>
    Effect.gen(function* () {
      const deliverables = yield* DeliverableService.DeliverableService;
      const record = Effect.fn("test.record")(function* (deck: string, source: string) {
        yield* repo.write("deck.pptx", deck);
        yield* repo.write("src/slides.ts", source);
        return (yield* deliverables.registerVersion({ projectId, path: "deck.pptx" })).version;
      });
      const v1 = yield* record("Title\nAgenda\nClose", "export const v = 1;\n");
      const v2 = yield* record("Title\nAgenda v2\nClose", "export const v = 2;\n");
      const third = yield* record("Title\nAgenda v2\nClose\nThanks", "export const v = 2;\n");

      // Undo twice, redo once: files on disk follow, sources included.
      const firstUndo = yield* deliverables.undo(v1.deliverableId);
      assert.equal(firstUndo.deliverable.currentVersionId, v2.id);
      const secondUndo = yield* deliverables.undo(v1.deliverableId);
      assert.include(secondUndo.restoredPaths, "deck.pptx");
      assert.equal(secondUndo.deliverable.currentVersionId, v1.id);
      assert.equal(yield* repo.read("deck.pptx"), "Title\nAgenda\nClose");
      assert.equal(yield* repo.read("src/slides.ts"), "export const v = 1;\n");
      const redone = yield* deliverables.redo(v1.deliverableId);
      assert.equal(redone.deliverable.currentVersionId, v2.id);
      const atRedo = v2;
      assert.equal(yield* repo.read("deck.pptx"), "Title\nAgenda v2\nClose");
      assert.equal(yield* repo.read("src/slides.ts"), "export const v = 2;\n");

      // Hand edits since the current version are not overwritten.
      yield* repo.write("deck.pptx", "hand edit");
      const blocked = yield* deliverables.undo(v1.deliverableId).pipe(Effect.flip);
      assert.equal(blocked.reason, "workspace_changed");
      yield* repo.write("deck.pptx", "Title\nAgenda v2\nClose");

      busy.value = true;
      const running = yield* deliverables.undo(v1.deliverableId).pipe(Effect.flip);
      assert.equal(running.reason, "turn_running");
      busy.value = false;

      // A new edit after the undo forks from the current version; the old line stays an alternate.
      yield* repo.write("deck.pptx", "Title\nAgenda v2\nClose\nAppendix");
      const fork = (yield* deliverables.registerVersion({ projectId, path: "deck.pptx" })).version;
      assert.equal(fork.parentVersionId, atRedo.id);
      const graph = yield* deliverables.versionGraph(v1.deliverableId);
      assert.equal(graph.currentVersionId, fork.id);
      assert.deepEqual(
        graph.nodes.filter((node) => node.alternate).map((node) => node.versionId),
        [third.id],
      );
      assert.equal(yield* repo.git("rev-parse", `${fork.commitOid}^`), atRedo.commitOid);

      const restored = yield* deliverables.restore({
        deliverableId: v1.deliverableId,
        versionId: third.id,
      });
      assert.equal(restored.deliverable.currentVersionId, third.id);
      assert.equal(yield* repo.read("deck.pptx"), "Title\nAgenda v2\nClose\nThanks");
    }),
  ),
);

it.live("tells the next turn which versions were restored since the last one", () =>
  withEngine((repo) =>
    Effect.gen(function* () {
      const deliverables = yield* DeliverableService.DeliverableService;
      const record = Effect.fn("test.record")(function* (deck: string) {
        yield* repo.write("deck.pptx", deck);
        return (yield* deliverables.registerVersion({ projectId, path: "deck.pptx" })).version;
      });
      yield* record("One");
      yield* record("Two");
      const before = yield* DateTime.now;
      yield* deliverables.undo((yield* record("Three")).deliverableId);
      const turnNotes = (kind: "code" | "work") =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            INSERT INTO projection_projects (
              project_id, title, workspace_root, auto_pull, scripts_json, kind, created_at,
              updated_at
            ) VALUES (
              ${projectId}, 'Deck', ${repo.root}, 0, '[]', ${kind}, ${DateTime.formatIso(before)},
              ${DateTime.formatIso(before)}
            )
            ON CONFLICT (project_id) DO UPDATE SET kind = excluded.kind
          `;
          const service = yield* TurnContextNotes.TurnContextNotes;
          return yield* service.since({ projectId, since: before });
        }).pipe(
          Effect.provide(
            DeliverableTurnNotes.layer.pipe(
              Layer.provideMerge(
                ProjectStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
              ),
            ),
          ),
        );
      const restored =
        "Since your last turn, deliverables moved to other versions:\n- deck.pptx was undone to V2; it and the sources that changed with it now match V2.\nWork from these files, not from what you last wrote.";
      assert.deepEqual(yield* turnNotes("code"), [restored]);
      // A Work project's turns also learn how its files are versioned.
      assert.deepEqual(yield* turnNotes("work"), [
        DeliverableTurnNotes.workProjectInstructions(["deck.pptx"]),
        restored,
      ]);
    }),
  ),
);

it.live("moves notes from sent to fixed in the version their run made, and back to open", () =>
  withEngine((repo) =>
    Effect.gen(function* () {
      const deliverables = yield* DeliverableService.DeliverableService;
      const notes = yield* DeliverableNotes.DeliverableNotes;
      yield* repo.write("deck.pptx", "Title\nAgenda");
      const v1 = (yield* deliverables.registerVersion({ projectId, path: "deck.pptx" })).version;
      const create = (body: string) =>
        notes.create({
          deliverableId: v1.deliverableId,
          versionId: v1.id,
          anchor: { kind: "slide", index: 1 },
          body,
        });
      const marked = yield* create("Punchier agenda");
      const skipped = yield* create("Bigger logo");
      const messageId = MessageId.make("message-notes");
      const runId = RunId.make("run-notes");
      const sent = yield* notes.markSent({
        noteIds: [marked.id, skipped.id],
        threadId,
        messageId,
      });
      assert.deepEqual(
        sent.map((note) => note.status),
        ["fixing", "fixing"],
      );
      yield* notes.linkRun({ messageId, runId });

      // The agent says it addressed one note before its turn makes a version.
      const [addressed] = yield* notes.markFixed({
        projectId,
        noteIds: [marked.id],
        reply: "Led with the 40% number.",
        checkAnchor: { kind: "slide", index: 1 },
        runId,
      });
      assert.equal(addressed?.status, "fixing");

      yield* repo.write("deck.pptx", "Title\nAgenda: 40% faster");
      const v2 = (yield* deliverables.registerVersion({ projectId, path: "deck.pptx", runId }))
        .version;
      yield* notes.settleRun({ projectId, runId, final: false });
      yield* notes.settleRun({ projectId, runId, final: true });

      const byId = new Map((yield* notes.list(projectId)).map((note) => [note.id, note]));
      assert.equal(byId.get(marked.id)?.status, "fixed");
      assert.equal(byId.get(marked.id)?.fixedInVersionId, v2.id);
      assert.equal(byId.get(marked.id)?.reply, "Led with the 40% number.");
      assert.equal(byId.get(marked.id)?.sentRunId, runId);
      // Sent with it but not marked, so the agent did not claim it.
      assert.equal(byId.get(skipped.id)?.status, "open");

      const resolved = yield* notes.setStatus({ noteId: marked.id, status: "resolved" });
      assert.equal(resolved.status, "resolved");
      assert.isNotNull(resolved.resolvedAt);
      const reopened = yield* notes.setStatus({ noteId: marked.id, status: "open" });
      assert.equal(reopened.status, "open");
      assert.isNull(reopened.fixedInVersionId);
    }),
  ),
);

it.live("offers a revision saved under a new name as the next version, and adopts it", () =>
  withEngine((repo) =>
    Effect.gen(function* () {
      const deliverables = yield* DeliverableService.DeliverableService;
      const notes = yield* DeliverableNotes.DeliverableNotes;
      const checkpoints = yield* CheckpointStore.CheckpointStore;
      yield* repo.write("deck.pptx", "Title\nAgenda");
      const v1 = (yield* deliverables.registerVersion({ projectId, path: "deck.pptx" })).version;
      const note = yield* notes.create({
        deliverableId: v1.deliverableId,
        versionId: v1.id,
        anchor: { kind: "slide", index: 1 },
        body: "Punchier agenda",
      });
      const messageId = MessageId.make("message-stray");
      const runId = RunId.make("run-2");
      yield* notes.markSent({ noteIds: [note.id], threadId, messageId });
      yield* notes.linkRun({ messageId, runId });

      // The agent writes its revision to a copy and leaves deck.pptx alone.
      yield* repo.write("deck-v2.pptx", "Title\nAgenda: 40% faster");
      const ref = CheckpointRef.make("refs/t3/test-checkpoints/stray");
      yield* checkpoints.captureCheckpoint({ cwd: repo.root, checkpointRef: ref });
      const [strayV1] = yield* deliverables.detectFromCheckpoint({
        threadId,
        checkpoint: {
          ...checkpoint(2, ref),
          files: [{ path: "deck-v2.pptx", kind: "added", additions: 2, deletions: 0 }],
        },
      });
      assert.isDefined(strayV1);
      yield* notes.settleRun({ projectId, runId, final: true });
      const stray = (yield* deliverables.versions(strayV1.deliverableId)).deliverable;
      assert.equal(stray.strayVersionOf, v1.deliverableId);
      assert.equal((yield* notes.list(projectId))[0]?.status, "open");

      busy.value = true;
      const refused = yield* deliverables
        .resolveStray({ deliverableId: stray.id, adopt: true })
        .pipe(Effect.flip);
      assert.equal(refused.reason, "turn_running");
      busy.value = false;

      const adopted = yield* deliverables.resolveStray({ deliverableId: stray.id, adopt: true });
      assert.equal(adopted.deliverable.id, v1.deliverableId);
      assert.equal(adopted.deliverable.versionCount, 2);
      assert.equal(yield* repo.read("deck.pptx"), "Title\nAgenda: 40% faster");
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      assert.isFalse(yield* fileSystem.exists(path.join(repo.root, "deck-v2.pptx")));
      assert.deepEqual(
        (yield* deliverables.list(projectId)).map((deliverable) => deliverable.path),
        ["deck.pptx"],
      );
      const [fixed] = yield* notes.list(projectId);
      assert.equal(fixed?.status, "fixed");
      assert.equal(fixed?.fixedInVersionId, adopted.deliverable.currentVersionId);
      // The copy's own version history is gone from Git too.
      assert.notInclude(yield* repo.git("for-each-ref", "--format=%(refname)"), strayV1.ref);

      // Kept as its own file, a later copy stops asking.
      yield* repo.write("deck (2).pptx", "Title\nOther");
      const keepRef = CheckpointRef.make("refs/t3/test-checkpoints/keep");
      yield* checkpoints.captureCheckpoint({ cwd: repo.root, checkpointRef: keepRef });
      const [copy] = yield* deliverables.detectFromCheckpoint({
        threadId,
        checkpoint: {
          ...checkpoint(3, keepRef),
          files: [{ path: "deck (2).pptx", kind: "added", additions: 2, deletions: 0 }],
        },
      });
      assert.isDefined(copy);
      const kept = yield* deliverables.resolveStray({
        deliverableId: copy.deliverableId,
        adopt: false,
      });
      assert.isNull(kept.deliverable.strayVersionOf);
      const again = yield* deliverables
        .resolveStray({ deliverableId: copy.deliverableId, adopt: true })
        .pipe(Effect.flip);
      assert.equal(again.reason, "not_stray");

      // A copy the agent registers by name through the MCP tool is offered the same way.
      yield* repo.write("brief/brief.pptx", "Brief");
      const brief = (yield* deliverables.registerVersion({ projectId, path: "brief/brief.pptx" }))
        .deliverable;
      assert.isNull(brief.strayVersionOf);
      yield* repo.write("brief/brief-v2.pptx", "Brief, tighter");
      const registered = yield* deliverables.registerVersion({
        projectId,
        path: "brief/brief-v2.pptx",
      });
      assert.equal(registered.deliverable.strayVersionOf, brief.id);
    }),
  ),
);

it.live("judges an image on its display pixels, reading them only when the files differ", () =>
  withEngine((repo) =>
    Effect.gen(function* () {
      const deliverables = yield* DeliverableService.DeliverableService;
      const record = Effect.fn("test.record")(function* (text: string) {
        yield* repo.write("cover.png", text);
        return (yield* deliverables.registerVersion({ projectId, path: "cover.png" })).version;
      });
      const v1 = yield* record("Draft");
      const v2 = yield* record("Draft two");
      // New bytes that render to the same display image.
      const v3 = yield* record("Draft two\n");
      yield* deliverables.drain;
      rendererCalls.readImage = 0;

      const edited = yield* deliverables.compare({ targetVersionId: v2.id });
      assert.equal(edited.method, "perceptual");
      assert.equal(edited.headline, "1 image changed");
      // The bar grew from 5 to 9 pixels and the outlines of the two are the same. One pixel of
      // the growth passes as a one-pixel shift; the other three are the change.
      assert.deepEqual(edited.units[0]?.anchor, {
        kind: "slide",
        index: 0,
        region: frameRegion({ x: 5 / 96, y: 0, w: 3 / 96, h: 8 / 96 }),
      });
      assert.equal(rendererCalls.readImage, 2);
      assert.equal(v1.id, edited.baseVersionId);

      // Asked again, the answer is kept; the same display bytes are never decoded at all.
      yield* deliverables.compare({ targetVersionId: v2.id });
      const resaved = yield* deliverables.compare({ targetVersionId: v3.id });
      assert.equal(resaved.headline, "No visible change");
      assert.equal(rendererCalls.readImage, 2);
    }),
  ),
);

it.live("resamples a video rendered before the frame grid grew, once, then compares it", () =>
  withEngine((repo) =>
    Effect.gen(function* () {
      const deliverables = yield* DeliverableService.DeliverableService;
      const repository = yield* DeliverableRepository.DeliverableRepository;
      const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const record = Effect.fn("test.record")(function* (text: string) {
        yield* repo.write("cut.mp4", text);
        return (yield* deliverables.registerVersion({ projectId, path: "cut.mp4" })).version;
      });
      const v1 = yield* record("a short caption");
      const v2 = yield* record("a rather longer caption, by a good way");
      yield* deliverables.drain;
      rendererCalls.sampleFrames = 0;

      const comparison = yield* deliverables.compare({ targetVersionId: v2.id });
      assert.equal(comparison.method, "perceptual");
      assert.equal(comparison.headline, "1 shot changed");
      assert.deepEqual(comparison.units[0]?.anchor, {
        kind: "time",
        t: 0,
        tEnd: 1,
        region: frameRegion({ x: 15 / VIDEO_GRID, y: 0, w: 23 / VIDEO_GRID, h: 8 / VIDEO_GRID }),
      });
      assert.equal(rendererCalls.sampleFrames, 2);

      // The finer frames are saved on the rendition and the old file is gone.
      for (const version of [v1, v2]) {
        const stored = yield* repository.getRendition({
          contentSha256: version.contentSha256,
          kind: "video",
        });
        assert.deepEqual(
          (Option.getOrThrow(stored).data as DeliverableRenderers.RenderOutput).samples,
          { file: `frames-${VIDEO_GRID}.rgb`, fps: 1, grid: VIDEO_GRID },
        );
        const directory = blobs.renditionDir({ sha256: version.contentSha256, kind: "video" });
        assert.isFalse(yield* fileSystem.exists(path.join(directory, "samples.rgb")));
      }
      yield* deliverables.compare({ targetVersionId: v2.id });
      assert.equal(rendererCalls.sampleFrames, 2);
    }),
  ),
);

it.live("ends a render that crashes or has lost its file as failed, and renders it again", () =>
  withEngine((repo) =>
    Effect.gen(function* () {
      const deliverables = yield* DeliverableService.DeliverableService;
      const repository = yield* DeliverableRepository.DeliverableRepository;
      const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;
      const fileSystem = yield* FileSystem.FileSystem;
      yield* repo.write("deck.pptx", "Title\nAgenda");
      rendering.mode = "crashes";
      const v1 = (yield* deliverables.registerVersion({ projectId, path: "deck.pptx" })).version;
      yield* deliverables.drain;
      const crashed = yield* deliverables.rendition(v1.id);
      assert.equal(crashed.status, "failed");
      assert.equal(crashed.detail, "Rendering stopped unexpectedly.");

      // The stored file is gone: said in plain words, and still a final state.
      rendering.mode = "works";
      const stored = blobs.blobPath(v1.contentSha256);
      const bytes = yield* fileSystem.readFile(stored);
      yield* fileSystem.remove(stored);
      yield* deliverables.retryRendition(v1.id);
      yield* deliverables.drain;
      const lost = yield* deliverables.rendition(v1.id);
      assert.equal(lost.status, "failed");
      assert.equal(lost.detail, DeliverableRenditions.SOURCE_MISSING_DETAIL);

      yield* fileSystem.writeFile(stored, bytes);
      yield* deliverables.retryRendition(v1.id);
      yield* deliverables.drain;
      assert.equal((yield* deliverables.rendition(v1.id)).status, "ready");

      // What a process that stopped mid-render leaves behind is back in line when the next starts.
      const content = { contentSha256: v1.contentSha256, kind: "deck" } as const;
      yield* repository.putRendition({
        ...content,
        status: "rendering",
        renderer: null,
        detail: null,
        data: null,
        updatedAt: yield* DateTime.now,
      });
      yield* DeliverableRenditions.DeliverableRenditions.pipe(
        Effect.provide(DeliverableRenditions.layerWith({ deadline: Duration.minutes(30) })),
      );
      assert.equal(Option.getOrThrow(yield* repository.getRendition(content)).status, "pending");
      assert.deepEqual(yield* repository.listUnfinished, [v1.id]);
    }),
  ),
);

it.live("stops a render that outlasts its deadline and records why", () =>
  withEngine(
    (repo) =>
      Effect.gen(function* () {
        const deliverables = yield* DeliverableService.DeliverableService;
        yield* repo.write("deck.pptx", "Title");
        rendering.mode = "hangs";
        const v1 = (yield* deliverables.registerVersion({ projectId, path: "deck.pptx" })).version;
        yield* deliverables.drain;
        const stopped = yield* deliverables.rendition(v1.id);
        assert.equal(stopped.status, "failed");
        assert.equal(stopped.detail, "Rendering took longer than 0 minutes and was stopped.");
      }),
    { renderDeadline: Duration.zero },
  ),
);

it.live("says why two versions cannot be compared, one cause at a time", () =>
  withEngine((repo) =>
    Effect.gen(function* () {
      const deliverables = yield* DeliverableService.DeliverableService;
      const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const record = Effect.fn("test.record")(function* (text: string) {
        yield* repo.write("cover.png", text);
        return (yield* deliverables.registerVersion({
          projectId,
          path: "cover.png",
          expectedChanges: [{ kind: "slide", index: 0 }],
        })).version;
      });
      const unavailable = (versionId: typeof v1.id, baseVersionId?: typeof v1.id) =>
        Effect.map(
          deliverables.compare({ targetVersionId: versionId, baseVersionId }),
          (comparison) => ({
            headline: comparison.headline,
            units: comparison.units.length,
            ...comparison.unavailable,
          }),
        );
      const selfCheck = (versionId: typeof v1.id) =>
        Effect.map(
          deliverables.versions(v1.deliverableId),
          ({ versions }) => versions.find((version) => version.id === versionId)?.selfCheck,
        );
      const v1 = yield* record("Draft");
      yield* deliverables.drain;

      rendering.mode = "crashes";
      const v2 = yield* record("Draft two");
      yield* deliverables.drain;
      const notRendered = {
        headline: "Not rendered",
        units: 0,
        reason: "render_failed",
        versionId: v2.id,
        message:
          "V2 could not be rendered, so there is nothing to compare it with. Open it to see why and to render it again.",
      } as const;
      assert.deepEqual(yield* unavailable(v2.id), notRendered);
      // The check that needed the comparison says the same, and is owed once V2 renders.
      assert.deepEqual(
        {
          status: (yield* selfCheck(v2.id))?.status,
          findings: (yield* selfCheck(v2.id))?.findings,
        },
        { status: "skipped", findings: [notRendered.message] },
      );

      const stored = blobs.blobPath(v2.contentSha256);
      const bytes = yield* fileSystem.readFile(stored);
      yield* fileSystem.remove(stored);
      assert.deepEqual(yield* unavailable(v2.id), {
        headline: "File missing",
        units: 0,
        reason: "source_missing",
        versionId: v2.id,
        message: "V2's file is missing from the store on this computer, so it cannot be compared.",
      });

      yield* fileSystem.writeFile(stored, bytes);
      rendering.mode = "works";
      yield* deliverables.retryRendition(v2.id);
      yield* deliverables.drain;
      const compared = yield* deliverables.compare({ targetVersionId: v2.id });
      assert.isNull(compared.unavailable);
      assert.equal(compared.headline, "1 image changed");
      assert.equal((yield* selfCheck(v2.id))?.status, "passed");

      const v3 = yield* record("Draft three");
      yield* deliverables.drain;
      yield* fileSystem.remove(
        path.join(
          blobs.renditionDir({ sha256: v3.contentSha256, kind: "image" }),
          "image-0001.rgb",
        ),
      );
      // Its self-check already compared it with V2 and that answer is kept; V1 is a new pair.
      assert.deepEqual(yield* unavailable(v3.id, v1.id), {
        headline: "Not compared",
        units: 0,
        reason: "comparison_failed",
        versionId: v3.id,
        message: "V3's rendered files could not be read, so the comparison failed.",
      });

      rendering.mode = "hangs";
      rendering.hung = yield* Deferred.make<void>();
      const v4 = yield* record("Draft four");
      yield* Deferred.await(rendering.hung);
      assert.deepEqual(yield* unavailable(v4.id), {
        headline: "Still rendering",
        units: 0,
        reason: "rendering",
        versionId: v4.id,
        message: "V4 is still rendering. The comparison appears when it is done.",
      });
    }),
  ),
);

it.live("redoes page outlines made on the coarser grid, once, then compares them", () =>
  withEngine((repo) =>
    Effect.gen(function* () {
      const deliverables = yield* DeliverableService.DeliverableService;
      const repository = yield* DeliverableRepository.DeliverableRepository;
      const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const record = Effect.fn("test.record")(function* (text: string) {
        yield* repo.write("brief.pdf", text);
        return (yield* deliverables.registerVersion({ projectId, path: "brief.pdf" })).version;
      });
      const v1 = yield* record("Brief");
      const v2 = yield* record("Brief, tighter");
      yield* deliverables.drain;
      rendererCalls.outlineImage = 0;

      const comparison = yield* deliverables.compare({ targetVersionId: v2.id });
      assert.equal(comparison.headline, "1 page changed");
      assert.equal(rendererCalls.outlineImage, 2);
      for (const version of [v1, v2]) {
        const stored = yield* repository.getRendition({
          contentSha256: version.contentSha256,
          kind: "pdf",
        });
        assert.deepEqual(
          (Option.getOrThrow(stored).data as DeliverableRenderers.RenderOutput).units[0]?.signature,
          { file: `page-0001-outline${OUTLINE_GRID}.rgb`, grid: OUTLINE_GRID },
        );
        const directory = blobs.renditionDir({ sha256: version.contentSha256, kind: "pdf" });
        assert.isFalse(yield* fileSystem.exists(path.join(directory, "page-0001.rgb")));
      }
      yield* deliverables.compare({ targetVersionId: v2.id });
      assert.equal(rendererCalls.outlineImage, 2);
    }),
  ),
);

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

it.live(
  "cleans out what a deleted project stored and what a crash left, and nothing still in use",
  () =>
    withEngine((repo) =>
      Effect.gen(function* () {
        const deliverables = yield* DeliverableService.DeliverableService;
        const notes = yield* DeliverableNotes.DeliverableNotes;
        const cleanup = yield* DeliverableStoreCleanup.DeliverableStoreCleanup;
        const repository = yield* DeliverableRepository.DeliverableRepository;
        const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sql = yield* SqlClient.SqlClient;
        const plant = (file: string) =>
          fileSystem
            .makeDirectory(path.dirname(file), { recursive: true })
            .pipe(Effect.andThen(fileSystem.writeFileString(file, "left over")));
        const counts = ({ bytes: _bytes, ...report }: DeliverableStoreCleanup.CleanupReport) =>
          report;
        const nothing = {
          blobs: 0,
          renditions: 0,
          renditionFiles: 0,
          noteSnapshots: 0,
          blobsSwept: true,
        };

        // The other project's deck is in the folder first, so both projects' snapshots hold it.
        yield* repo.write("other.pptx", "Other deck");
        const other = (yield* deliverables.registerVersion({
          projectId: otherProjectId,
          path: "other.pptx",
        })).version;
        const record = Effect.fn("test.record")(function* (deck: string) {
          yield* repo.write("deck.pptx", deck);
          return (yield* deliverables.registerVersion({ projectId, path: "deck.pptx" })).version;
        });
        const v1 = yield* record("Title\nAgenda");
        yield* repo.write("logo.png", "logo");
        const logo = yield* blobs.hash(path.join(repo.root, "logo.png"));
        const v2 = yield* record("Title\nAgenda v2");
        // Undone and forked away from: V2 and the logo only it has are no longer on the line.
        yield* deliverables.undo(v1.deliverableId);
        const v3 = yield* record("Title\nAppendix");
        const note = yield* notes.create({
          deliverableId: v1.deliverableId,
          versionId: v1.id,
          anchor: { kind: "slide", index: 0 },
          body: "Bigger title",
          snapshotDataUrl: PNG_DATA_URL,
        });
        const snapshot = path.join(blobs.root, "notes", `${note.id}.png`);
        yield* deliverables.drain;
        const inUse = [v1, v2, v3, other].map((version) => version.contentSha256);

        assert.deepEqual(counts(yield* cleanup.run), nothing);
        for (const sha256 of [...inUse, logo.sha256]) assert.isTrue(yield* blobs.has(sha256));
        assert.isTrue(yield* fileSystem.exists(snapshot));

        // What a crash between writing bytes and recording them leaves behind.
        const unrecorded = "ab".repeat(32);
        const strayBlob = blobs.blobPath(unrecorded);
        const partial = path.join(path.dirname(strayBlob), ".partial-crash");
        const strayRendition = path.join(
          blobs.renditionDir({ sha256: unrecorded, kind: "deck" }),
          "slide-0001.jpg",
        );
        const staleFile = path.join(
          blobs.renditionDir({ sha256: v1.contentSha256, kind: "deck" }),
          "slide-0099.jpg",
        );
        const straySnapshot = path.join(blobs.root, "notes", "note_gone.png");
        yield* Effect.forEach(
          [strayBlob, partial, strayRendition, staleFile, straySnapshot],
          plant,
          { discard: true },
        );
        yield* repository.recordBlob({
          gitBlobOid: "f".repeat(40),
          contentSha256: unrecorded,
          sizeBytes: 9,
        });
        yield* repository.putRendition({
          contentSha256: unrecorded,
          kind: "deck",
          status: "ready",
          renderer: "test-lines@1",
          detail: null,
          data: null,
          updatedAt: yield* DateTime.now,
        });
        assert.deepEqual(counts(yield* cleanup.run), {
          ...nothing,
          blobs: 1,
          renditions: 1,
          renditionFiles: 1,
          noteSnapshots: 1,
        });
        for (const file of [strayBlob, partial, strayRendition, staleFile, straySnapshot]) {
          assert.isFalse(yield* fileSystem.exists(file), file);
        }
        assert.equal((yield* repository.lookupBlobs(["f".repeat(40)])).size, 0);
        for (const sha256 of [...inUse, logo.sha256]) assert.isTrue(yield* blobs.has(sha256));
        assert.isTrue(yield* fileSystem.exists(snapshot));

        // A version from before snapshots listed their files keeps every stored file until its
        // commit has been read; once it has, the logo only its snapshot holds is still kept.
        yield* sql`DELETE FROM deliverable_version_blobs WHERE version_id = ${v2.id}`;
        yield* plant(strayBlob);
        projects.unreadable = true;
        assert.deepEqual(counts(yield* cleanup.run), { ...nothing, blobsSwept: false });
        assert.isTrue(yield* fileSystem.exists(strayBlob));
        projects.unreadable = false;
        assert.deepEqual(counts(yield* cleanup.run), { ...nothing, blobs: 1 });
        assert.isTrue(yield* blobs.has(logo.sha256));

        // The undone version restores with its logo: nothing it needs was taken.
        yield* deliverables.restore({ deliverableId: v1.deliverableId, versionId: v2.id });
        assert.equal(yield* repo.read("logo.png"), "logo");

        // A project that is still there loses nothing when asked.
        assert.equal(yield* deliverables.removeProject(projectId), 0);
        projects.deleted.add(projectId);
        assert.equal(yield* deliverables.removeProject(projectId), 1);
        yield* cleanup.drain;

        for (const version of [v1, v2, v3]) {
          assert.isFalse(yield* blobs.has(version.contentSha256));
          assert.isFalse(
            yield* fileSystem.exists(
              blobs.renditionDir({ sha256: version.contentSha256, kind: "deck" }),
            ),
          );
          assert.isTrue(
            Option.isNone(
              yield* repository.getRendition({
                contentSha256: version.contentSha256,
                kind: "deck",
              }),
            ),
          );
        }
        assert.isFalse(yield* blobs.has(logo.sha256));
        assert.isFalse(yield* fileSystem.exists(snapshot));
        assert.deepEqual(yield* notes.list(projectId), []);
        const refs = yield* repo.git("for-each-ref", "--format=%(refname)");
        assert.notInclude(refs, v1.deliverableId);
        assert.include(refs, other.ref);

        // The other project's deck, which the deleted project's snapshots also held, is intact.
        assert.isTrue(yield* blobs.has(other.contentSha256));
        assert.equal((yield* deliverables.rendition(other.id)).status, "ready");
        assert.deepEqual(
          (yield* deliverables.list(otherProjectId)).map((deliverable) => deliverable.path),
          ["other.pptx"],
        );
      }),
    ),
);
