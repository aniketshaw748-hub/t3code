import {
  type DeliverableComparison,
  DeliverableComparisonUnavailableReason,
  type DeliverableKind,
  type DeliverableUnitChange,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as DeliverableBlobStore from "./DeliverableBlobStore.ts";
import * as DeliverableRenderers from "./DeliverableRenderers.ts";
import * as DeliverableRenditions from "./DeliverableRenditions.ts";
import {
  DISPLAY_TOLERANCE,
  OUTLINE_GRID,
  rasterDifference,
  SAME,
  type UnitDifference,
  type UnitSignature,
  unmeasuredDifference,
  VIDEO_GRID,
} from "./perceptualDiff.ts";
import { alignSequences, compareHashes, sequenceChanges } from "./sequenceDiff.ts";
import { alignTimelines, removedShots, samplesFromBytes, shotChange } from "./timelineDiff.ts";

/** Content comparisons kept in memory; each is a few hundred bytes. */
const COMPARISON_CACHE_CAPACITY = 128;

export type ComparisonSide = "base" | "target";

/** What changed between two stored contents, whichever versions hold them, or why that is unknown. */
export type ContentComparison =
  | {
      readonly type: "compared";
      readonly method: Exclude<DeliverableComparison["method"], "bytes">;
      readonly units: ReadonlyArray<DeliverableUnitChange>;
      /** False while a unit could not be measured, so it is worked out again next time. */
      readonly settled: boolean;
    }
  | {
      readonly type: "unavailable";
      readonly reason: DeliverableComparisonUnavailableReason;
      /** The content that holds the comparison up; null when the comparing itself failed. */
      readonly side: ComparisonSide | null;
    };

export interface ContentPair {
  readonly kind: DeliverableKind;
  readonly baseSha256: string;
  readonly targetSha256: string;
}

/** Compares two stored contents by their renditions. It never fails: a cause it cannot get past is its answer. */
export class DeliverableComparer extends Context.Service<
  DeliverableComparer,
  { readonly compare: (pair: ContentPair) => Effect.Effect<ContentComparison> }
>()("t3/deliverables/DeliverableComparer") {}

class ComparisonBlocked extends Schema.TaggedError<ComparisonBlocked>()("ComparisonBlocked", {
  reason: DeliverableComparisonUnavailableReason,
  side: Schema.NullOr(Schema.Literals(["base", "target"])),
}) {}

const isBlocked = Schema.is(ComparisonBlocked);

const contentKey = (pair: ContentPair) => `${pair.kind}:${pair.baseSha256}:${pair.targetSha256}`;

const make = Effect.gen(function* () {
  const renditions = yield* DeliverableRenditions.DeliverableRenditions;
  const renderers = yield* DeliverableRenderers.DeliverableRenderers;
  const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // One upgrade of a rendition's comparison files at a time: two comparisons often share a version.
  const upgradeLock = yield* KeyedLock.make<string>();

  const blocked = (reason: DeliverableComparisonUnavailableReason, side: ComparisonSide | null) =>
    new ComparisonBlocked({ reason, side });
  /** Anything that goes wrong while reading or deriving from one side is that side's failure. */
  const failingAs =
    (side: ComparisonSide | null, doing: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.tapError((error) =>
          isBlocked(error)
            ? Effect.void
            : Effect.logWarning(`Could not compare deliverable versions: ${doing}`, { error }),
        ),
        Effect.mapError((error) => (isBlocked(error) ? error : blocked("comparison_failed", side))),
      );

  const readFile = (content: DeliverableRenditions.RenditionContent, file: string) =>
    fileSystem.readFile(path.join(blobs.renditionDir(content), file));

  /** The ready rendition of one side, or the reason it has none. */
  const readyOutput = Effect.fn("DeliverableComparer.readyOutput")(function* (
    side: ComparisonSide,
    content: DeliverableRenditions.RenditionContent,
  ) {
    const { stored, output } = yield* renditions.get(content);
    if (stored === null || stored.status === "pending" || stored.status === "rendering") {
      return yield* blocked("rendering", side);
    }
    if (stored.status !== "ready") {
      return yield* blocked(
        (yield* blobs.has(content.sha256)) ? "render_failed" : "source_missing",
        side,
      );
    }
    if (output === null) return yield* blocked("comparison_failed", side);
    return output;
  });

  /**
   * A video's rendition with its sampled frames on the current grid. One rendered before the grid
   * grew is resampled from the stored video and saved, once.
   */
  const videoOutput = (side: ComparisonSide, sha256: string) =>
    upgradeLock.withLock(
      sha256,
      Effect.gen(function* () {
        const content = { sha256, kind: "video" } as const;
        const output = yield* readyOutput(side, content);
        if (output.samples?.grid === VIDEO_GRID) return output;
        if (output.durationSeconds === null) return yield* blocked("comparison_failed", side);
        if (!(yield* blobs.has(sha256))) return yield* blocked("source_missing", side);
        const outDir = blobs.renditionDir(content);
        const durationSeconds = output.durationSeconds;
        return yield* blobs.whileWriting(
          Effect.gen(function* () {
            const samples = yield* renderers.sampleFrames({
              sourcePath: blobs.blobPath(sha256),
              outDir,
              durationSeconds,
            });
            const current = { ...output, samples };
            yield* renditions.replaceOutput(content, current);
            if (output.samples !== null && output.samples.file !== samples.file) {
              yield* fileSystem.remove(path.join(outDir, output.samples.file)).pipe(Effect.ignore);
            }
            return current;
          }),
        );
      }).pipe(failingAs(side, "resampling a video")),
    );

  /**
   * A deck's, PDF's or image's rendition with every outline on the current grid. Outlines made
   * when the grid was coarser are redone from the display images and saved, once.
   */
  const stillsOutput = (side: ComparisonSide, content: DeliverableRenditions.RenditionContent) =>
    upgradeLock.withLock(
      content.sha256,
      Effect.gen(function* () {
        const output = yield* readyOutput(side, content);
        const outdated = (unit: DeliverableRenderers.RenderedUnit) =>
          unit.signature !== null &&
          "file" in unit.signature &&
          unit.signature.grid !== OUTLINE_GRID &&
          unit.image !== null;
        if (!output.units.some(outdated)) return output;
        const outDir = blobs.renditionDir(content);
        return yield* blobs.whileWriting(
          Effect.gen(function* () {
            const replaced: string[] = [];
            const units = yield* Effect.forEach(output.units, (unit) =>
              Effect.gen(function* () {
                if (!outdated(unit) || unit.image === null || unit.signature === null) return unit;
                const file = `${path.basename(unit.image, path.extname(unit.image))}-outline${OUTLINE_GRID}.rgb`;
                yield* renderers.outlineImage({
                  imagePath: path.join(outDir, unit.image),
                  outlinePath: path.join(outDir, file),
                });
                if ("file" in unit.signature) replaced.push(unit.signature.file);
                return { ...unit, signature: { file, grid: OUTLINE_GRID } };
              }),
            );
            const current = { ...output, units };
            yield* renditions.replaceOutput(content, current);
            yield* Effect.forEach(
              replaced,
              (file) => fileSystem.remove(path.join(outDir, file)).pipe(Effect.ignore),
              { discard: true },
            );
            return current;
          }),
        );
      }).pipe(failingAs(side, "redoing slide outlines")),
    );

  const signatures = Effect.fn("DeliverableComparer.signatures")(function* (
    content: DeliverableRenditions.RenditionContent,
    output: DeliverableRenderers.RenderOutput,
  ) {
    return yield* Effect.forEach(output.units, (unit) =>
      unit.signature === null
        ? Effect.succeed<UnitSignature>({
            type: "hash",
            value: `${content.sha256}:${unit.index}`,
          })
        : "hash" in unit.signature
          ? Effect.succeed<UnitSignature>({ type: "hash", value: unit.signature.hash })
          : Effect.map(readFile(content, unit.signature.file), (outline): UnitSignature => ({
              type: "pixels",
              outline,
            })),
    );
  });

  const timeline = Effect.fn("DeliverableComparer.timeline")(function* (
    sha256: string,
    output: DeliverableRenderers.RenderOutput,
  ) {
    const samples =
      output.samples === null
        ? []
        : samplesFromBytes(
            yield* readFile({ sha256, kind: "video" }, output.samples.file),
            output.samples.fps,
            output.samples.grid ?? VIDEO_GRID,
          );
    return {
      duration: output.durationSeconds ?? 0,
      shots: output.units.map((unit) => ({
        index: unit.index,
        start: unit.start ?? 0,
        end: unit.end ?? 0,
      })),
      samples,
    };
  });

  /**
   * What changed between two rendered slides, pages or images, judged on the images Work mode
   * shows. The same content renders to the same bytes, so most pairs never need their pixels read.
   */
  const displayDifference = Effect.fn("DeliverableComparer.displayDifference")(function* (
    kind: DeliverableKind,
    base: { readonly sha256: string; readonly image: string },
    target: { readonly sha256: string; readonly image: string },
  ) {
    const [before, after] = [
      yield* readFile({ sha256: base.sha256, kind }, base.image),
      yield* readFile({ sha256: target.sha256, kind }, target.image),
    ];
    if (Buffer.compare(before, after) === 0) return SAME;
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const scratch = yield* blobs.scratchDir;
        const pixels = (side: typeof base, name: string) =>
          renderers.readImage({
            imagePath: path.join(blobs.renditionDir({ sha256: side.sha256, kind }), side.image),
            scratchPath: path.join(scratch, name),
          });
        return rasterDifference(
          yield* pixels(base, "base.ppm"),
          yield* pixels(target, "target.ppm"),
          DISPLAY_TOLERANCE,
        );
      }),
    );
  });

  /** Slides, pages or an image: lined up by outline, then each pair judged at display size. */
  const compareStills = Effect.fn("DeliverableComparer.compareStills")(function* (
    pair: ContentPair,
  ) {
    const { kind } = pair;
    const base = { sha256: pair.baseSha256, kind };
    const target = { sha256: pair.targetSha256, kind };
    const [baseOutput, targetOutput] = [
      yield* stillsOutput("base", base),
      yield* stillsOutput("target", target),
    ];
    const [baseSignatures, targetSignatures] = [
      yield* signatures(base, baseOutput).pipe(failingAs("base", "reading slide outlines")),
      yield* signatures(target, targetOutput).pipe(failingAs("target", "reading slide outlines")),
    ];
    const rendered = (all: ReadonlyArray<UnitSignature>) =>
      all.every((signature) => signature.type === "pixels");
    if (!rendered(baseSignatures) || !rendered(targetSignatures)) {
      return {
        type: "compared",
        method: rendered(targetSignatures) ? "perceptual" : "structural",
        units: compareHashes(baseSignatures, targetSignatures),
        settled: true,
      } satisfies ContentComparison;
    }
    let settled = true;
    const measured = yield* Effect.forEach(
      alignSequences(baseSignatures, targetSignatures),
      (aligned) => {
        const { baseIndex, targetIndex } = aligned;
        if (baseIndex === null || targetIndex === null) {
          return Effect.succeed({ ...aligned, difference: SAME });
        }
        const [baseImage, targetImage] = [
          baseOutput.units[baseIndex]?.image,
          targetOutput.units[targetIndex]?.image,
        ];
        const unmeasured = (): UnitDifference => {
          settled = false;
          return unmeasuredDifference(baseSignatures[baseIndex]!, targetSignatures[targetIndex]!);
        };
        if (baseImage == null || targetImage == null) {
          return Effect.succeed({ ...aligned, difference: unmeasured() });
        }
        return displayDifference(
          kind,
          { sha256: base.sha256, image: baseImage },
          { sha256: target.sha256, image: targetImage },
        ).pipe(
          // Images that differ but cannot be decoded still count as a change, just an unplaced one.
          Effect.catch((error) =>
            Effect.as(
              Effect.logWarning("Could not read a deliverable's pixels for comparison", {
                error: error.message,
              }),
              unmeasured(),
            ),
          ),
          Effect.map((difference) => ({ ...aligned, difference })),
        );
      },
      { concurrency: 2 },
    );
    return {
      type: "compared",
      method: "perceptual",
      units: sequenceChanges(measured),
      settled,
    } satisfies ContentComparison;
  });

  const compareVideos = Effect.fn("DeliverableComparer.compareVideos")(function* (
    pair: ContentPair,
  ) {
    const [baseOutput, targetOutput] = [
      yield* videoOutput("base", pair.baseSha256),
      yield* videoOutput("target", pair.targetSha256),
    ];
    const [before, after] = [
      yield* timeline(pair.baseSha256, baseOutput).pipe(failingAs("base", "reading its frames")),
      yield* timeline(pair.targetSha256, targetOutput).pipe(
        failingAs("target", "reading its frames"),
      ),
    ];
    const alignment = alignTimelines(before, after);
    // A shot at a time, so a long video never holds the server's one thread for seconds.
    const shots = yield* Effect.forEach(after.shots, (shot) =>
      Effect.andThen(
        Effect.yieldNow,
        Effect.sync(() => shotChange(alignment, shot)),
      ),
    );
    return {
      type: "compared",
      method: "perceptual",
      units: [...shots, ...removedShots(alignment)],
      settled: true,
    } satisfies ContentComparison;
  });

  const compareContent = (pair: ContentPair): Effect.Effect<ContentComparison> =>
    (pair.kind === "video" ? compareVideos(pair) : compareStills(pair)).pipe(
      failingAs(null, "comparing the renditions"),
      Effect.catchDefect((defect) =>
        Effect.andThen(
          Effect.logError("Comparing deliverable versions stopped on a defect", { defect }),
          Effect.fail(blocked("comparison_failed", null)),
        ),
      ),
      Effect.catch(({ reason, side }) =>
        Effect.succeed<ContentComparison>({ type: "unavailable", reason, side }),
      ),
      Effect.withSpan("DeliverableComparer.compareContent"),
    );

  // Content is immutable, so a settled comparison of two hashes never goes stale.
  const comparisons = yield* Cache.makeWith(
    (key: string) => {
      const [kind, baseSha256, targetSha256] = key.split(":") as [DeliverableKind, string, string];
      return compareContent({ kind, baseSha256, targetSha256 });
    },
    {
      capacity: COMPARISON_CACHE_CAPACITY,
      timeToLive: (exit) =>
        Exit.isSuccess(exit) && exit.value.type === "compared" && exit.value.settled
          ? Duration.infinity
          : Duration.zero,
    },
  );

  return DeliverableComparer.of({
    compare: Effect.fn("DeliverableComparer.compare")((pair) =>
      Cache.get(comparisons, contentKey(pair)),
    ),
  });
});

export const layer = Layer.effect(DeliverableComparer, make);
