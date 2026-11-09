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
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
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
import * as DeliverableContext from "./DeliverableContext.ts";
import * as DeliverableGit from "./DeliverableGit.ts";
import * as DeliverableRenderers from "./DeliverableRenderers.ts";
import * as DeliverableSelfCheck from "./DeliverableSelfCheck.ts";
import * as DeliverableNotes from "./DeliverableNotes.ts";
import * as DeliverableService from "./DeliverableService.ts";
import * as WorkProjectEvents from "./WorkProjectEvents.ts";
import * as DeliverableTurnNotes from "./DeliverableTurnNotes.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as TurnContextNotes from "../orchestration-v2/TurnContextNotes.ts";

const projectId = ProjectId.make("project-work");
const threadId = ThreadId.make("thread-work");

/** Stands in for PowerPoint: each line of the fixture "deck" is a slide, compared by hash. */
const layerLineRenderer = Layer.effect(
  DeliverableRenderers.DeliverableRenderers,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return DeliverableRenderers.DeliverableRenderers.of({
      render: (input) =>
        fileSystem.readFileString(input.sourcePath).pipe(
          Effect.orDie,
          Effect.map((text) => ({
            renderer: "test-lines@1",
            width: null,
            height: null,
            durationSeconds: null,
            poster: null,
            proxy: null,
            samples: null,
            detail: null,
            units: text.split("\n").map((line, index) => ({
              index,
              kind: "slide" as const,
              image: null,
              thumb: null,
              signature: { hash: NodeCrypto.createHash("sha256").update(line).digest("hex") },
            })),
          })),
        ),
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
const layerContext = (root: string) =>
  Layer.succeed(
    DeliverableContext.DeliverableContext,
    DeliverableContext.DeliverableContext.of({
      projectRoot: (id) => Effect.succeed(id === projectId ? root : null),
      turn: () =>
        Effect.succeed({
          projectId,
          cwd: root,
          reply: "## Made the title slide bolder\n\nDetails follow.",
          parentCheckpointRef: null,
        }),
      projectBusy: () => Effect.sync(() => busy.value),
    }),
  );

const layerPlatform = Layer.mergeAll(NodeServices.layer, NodeCryptoLayer.layer);
const layerVcsProcess = VcsProcess.layer.pipe(Layer.provide(layerPlatform));
const layerEngine = (root: string) =>
  DeliverableService.layer.pipe(
    Layer.provideMerge(DeliverableNotes.layer),
    Layer.provide(
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
        Layer.provide(SqlitePersistence.layerMemory),
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
) =>
  Effect.gen(function* () {
    const repo = yield* setup;
    return yield* body(repo).pipe(Effect.provide(layerEngine(repo.root)));
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
        assert.equal(v1.summary, "Made the title slide bolder");
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
        assert.equal(comparison.summary, "Made the title slide bolder");
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
    }),
  ),
);
