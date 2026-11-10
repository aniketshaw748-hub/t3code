import { DeliverableError, type DeliverableKind, type ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as DeliverableRepository from "../persistence/Deliverables.ts";
import * as DeliverableBlobStore from "./DeliverableBlobStore.ts";
import * as DeliverableRenderers from "./DeliverableRenderers.ts";
import * as WorkProjectEvents from "./WorkProjectEvents.ts";

/** Stored bytes and the kind they are rendered as: what a rendition belongs to. */
export interface RenditionContent {
  readonly sha256: string;
  readonly kind: DeliverableKind;
}

export interface StoredOutput {
  readonly stored: DeliverableRepository.StoredRendition | null;
  /** What the renderer produced; null until the rendition is ready. */
  readonly output: DeliverableRenderers.RenderOutput | null;
}

/** Renditions of stored content: one per content hash and kind, whichever versions hold it. */
export class DeliverableRenditions extends Context.Service<
  DeliverableRenditions,
  {
    readonly get: (content: RenditionContent) => Effect.Effect<StoredOutput, DeliverableError>;
    /**
     * Renders the content unless a render of it already ended. Every way a render can end is
     * recorded as ready, failed or unsupported, so nothing stays "rendering" once this returns.
     */
    readonly ensure: (
      input: RenditionContent & {
        /** The file's real name; the stored blob has none. */
        readonly fileName: string;
        readonly projectId: ProjectId;
      },
    ) => Effect.Effect<void, DeliverableError>;
    /**
     * Puts a rendition that ended without output back in line; false when there was none. The
     * next render looks for its tools again, so one installed since the last try is used.
     */
    readonly retry: (content: RenditionContent) => Effect.Effect<boolean, DeliverableError>;
    /** Saves a ready rendition's output again, after files derived from it were added. */
    readonly replaceOutput: (
      content: RenditionContent,
      output: DeliverableRenderers.RenderOutput,
    ) => Effect.Effect<void, DeliverableError>;
  }
>()("t3/deliverables/DeliverableRenditions") {}

class RenditionSourceMissing extends Schema.TaggedError<RenditionSourceMissing>()(
  "RenditionSourceMissing",
  {},
) {}
class RenditionTimedOut extends Schema.TaggedError<RenditionTimedOut>()("RenditionTimedOut", {}) {}

export const SOURCE_MISSING_DETAIL =
  "This version's file is no longer in the store on this computer, so it cannot be rendered. Add the file to the project again to make a new version.";
const STOPPED_DETAIL = "Rendering stopped unexpectedly.";

const decodeRenderOutput = Schema.decodeUnknownOption(DeliverableRenderers.RenderOutput);
const persistence = Effect.mapError(
  (cause: unknown) => new DeliverableError({ reason: "persistence_failed", cause }),
);

type Outcome = Pick<
  DeliverableRepository.StoredRendition,
  "status" | "renderer" | "detail" | "data"
>;
const failed = (detail: string): Outcome => ({
  status: "failed",
  renderer: null,
  detail,
  data: null,
});

export interface DeliverableRenditionsOptions {
  /** A render still running after this long is stopped and recorded as failed. */
  readonly deadline: Duration.Duration;
}

const make = Effect.fn("DeliverableRenditions.make")(function* (
  options: DeliverableRenditionsOptions,
) {
  const repository = yield* DeliverableRepository.DeliverableRepository;
  const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;
  const renderers = yield* DeliverableRenderers.DeliverableRenderers;
  const events = yield* WorkProjectEvents.WorkProjectEvents;
  const path = yield* Path.Path;

  // A render the last process was in the middle of did not end; the render queue takes it again.
  yield* repository.requeueInterruptedRenditions.pipe(
    Effect.tap((count) =>
      count === 0
        ? Effect.void
        : Effect.logInfo("Renditions interrupted by the last shutdown will render again", {
            count,
          }),
    ),
    Effect.catch((error) =>
      Effect.logWarning("Could not put interrupted renditions back in line", {
        error: error.message,
      }),
    ),
  );

  const key = (content: RenditionContent) => ({
    contentSha256: content.sha256,
    kind: content.kind,
  });

  const get: DeliverableRenditions["Service"]["get"] = Effect.fn("DeliverableRenditions.get")(
    function* (content) {
      const stored = yield* repository.getRendition(key(content)).pipe(persistence);
      if (Option.isNone(stored)) return { stored: null, output: null };
      const output =
        stored.value.status === "ready"
          ? Option.getOrNull(decodeRenderOutput(stored.value.data))
          : null;
      return { stored: stored.value, output };
    },
  );

  const put = (content: RenditionContent, outcome: Outcome) =>
    Effect.flatMap(DateTime.now, (updatedAt) =>
      repository.putRendition({ ...key(content), updatedAt, ...outcome }).pipe(persistence),
    );

  const render = Effect.fn("DeliverableRenditions.render")(function* (
    input: Parameters<DeliverableRenditions["Service"]["ensure"]>[0],
  ) {
    if (!(yield* blobs.has(input.sha256))) return yield* new RenditionSourceMissing();
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const scratchDir = yield* blobs.scratchDir;
        return yield* renderers.render({
          kind: input.kind,
          sourcePath: blobs.blobPath(input.sha256),
          fileName: path.basename(input.fileName),
          outDir: blobs.renditionDir(input),
          scratchDir,
        });
      }),
    );
  });

  /** How a render ended, as the rendition to record. Only an interruption passes through. */
  const settle = (input: Parameters<DeliverableRenditions["Service"]["ensure"]>[0]) =>
    render(input).pipe(
      Effect.timeoutOrElse({
        duration: options.deadline,
        orElse: () => Effect.fail(new RenditionTimedOut()),
      }),
      Effect.map((output): Outcome => ({
        status: "ready",
        renderer: output.renderer,
        detail: output.detail,
        data: output,
      })),
      Effect.catchTags({
        DeliverableRenderUnsupportedError: (error) =>
          Effect.succeed<Outcome>({
            status: "unsupported",
            renderer: null,
            detail: error.detail,
            data: null,
          }),
        DeliverableRenderError: (error) =>
          Effect.as(
            Effect.logWarning("Deliverable rendering failed", {
              stage: error.stage,
              cause: error.cause,
            }),
            failed(error.message),
          ),
        DeliverableBlobStoreError: (error) =>
          Effect.as(
            Effect.logWarning("Deliverable rendering could not use the store", {
              operation: error.operation,
              cause: error.cause,
            }),
            failed("Rendering could not write to the deliverable store on this computer."),
          ),
        RenditionSourceMissing: () => Effect.succeed(failed(SOURCE_MISSING_DETAIL)),
        RenditionTimedOut: () =>
          Effect.succeed(
            failed(
              `Rendering took longer than ${Math.round(Duration.toMinutes(options.deadline))} minutes and was stopped.`,
            ),
          ),
      }),
      Effect.catchDefect((defect) =>
        Effect.as(
          Effect.logError("Deliverable rendering stopped on a defect", { defect }),
          failed(STOPPED_DETAIL),
        ),
      ),
    );

  const ensure: DeliverableRenditions["Service"]["ensure"] = Effect.fn(
    "DeliverableRenditions.ensure",
  )(function* (input) {
    const existing = yield* repository.getRendition(key(input)).pipe(persistence);
    if (
      Option.isSome(existing) &&
      existing.value.status !== "pending" &&
      existing.value.status !== "rendering"
    ) {
      return;
    }
    const changed = events.publish({ type: "changed", projectId: input.projectId });
    yield* blobs.whileWriting(
      Effect.gen(function* () {
        yield* put(input, { status: "rendering", renderer: null, detail: null, data: null });
        yield* changed;
        yield* put(input, yield* settle(input));
        yield* changed;
      }),
    );
  });

  const retry: DeliverableRenditions["Service"]["retry"] = Effect.fn("DeliverableRenditions.retry")(
    function* (content) {
      const existing = yield* repository.getRendition(key(content)).pipe(persistence);
      if (
        Option.isNone(existing) ||
        (existing.value.status !== "failed" && existing.value.status !== "unsupported")
      ) {
        return false;
      }
      yield* renderers.recheckTools;
      yield* put(content, { status: "pending", renderer: null, detail: null, data: null });
      return true;
    },
  );

  const replaceOutput: DeliverableRenditions["Service"]["replaceOutput"] = Effect.fn(
    "DeliverableRenditions.replaceOutput",
  )(function* (content, output) {
    yield* put(content, {
      status: "ready",
      renderer: output.renderer,
      detail: output.detail,
      data: output,
    });
  });

  return DeliverableRenditions.of({ get, ensure, retry, replaceOutput });
});

export const layerWith = (options: DeliverableRenditionsOptions) =>
  Layer.effect(DeliverableRenditions, make(options));

export const layer = layerWith({ deadline: Duration.minutes(30) });
