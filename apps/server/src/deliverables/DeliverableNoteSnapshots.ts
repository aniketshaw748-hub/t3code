import type { Deliverable, DeliverableAnchor, DeliverableRegion } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import type * as DeliverableRepository from "../persistence/Deliverables.ts";
import * as DeliverableBlobStore from "./DeliverableBlobStore.ts";
import * as DeliverableRenderers from "./DeliverableRenderers.ts";
import * as DeliverableRenditions from "./DeliverableRenditions.ts";

/**
 * The picture kept with a note, shown on its card and given to the agent with it. A client that
 * sends its own (a drawing over the frame) has it kept as sent, because a drawing cannot be made
 * again here. Every other note that names a time, a slide or an area gets its picture made from
 * the stored version, so it is the same whichever client wrote the note.
 */
export class DeliverableNoteSnapshots extends Context.Service<
  DeliverableNoteSnapshots,
  {
    /**
     * Stores the note's picture and returns its path in the store, or null when the note is
     * about the whole file or its frame cannot be made. Call it inside `whileWriting`, with the
     * write of the note that points at it.
     */
    readonly capture: (input: {
      readonly deliverable: Deliverable;
      readonly version: DeliverableRepository.StoredDeliverableVersion;
      readonly anchor: DeliverableAnchor | null;
      /** PNG bytes the client sent with the note. */
      readonly clientPicture: Uint8Array | null;
    }) => Effect.Effect<string | null, DeliverableBlobStore.DeliverableBlobStoreError>;
  }
>()("t3/deliverables/DeliverableNoteSnapshots") {}

const regionOf = (anchor: DeliverableAnchor): DeliverableRegion | null =>
  anchor.kind === "region"
    ? { x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h }
    : (anchor.region ?? null);

const make = Effect.gen(function* () {
  const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;
  const renditions = yield* DeliverableRenditions.DeliverableRenditions;
  const renderers = yield* DeliverableRenderers.DeliverableRenderers;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const stored = (file: string) =>
    Effect.map(blobs.ingest({ path: file, move: true }), (blob) =>
      path.relative(blobs.root, blobs.blobPath(blob.sha256)).split(path.sep).join("/"),
    );

  /** What to take the picture from: the stored video at a time, or a rendered still. */
  const frameSource = Effect.fn("DeliverableNoteSnapshots.frameSource")(function* (
    input: Parameters<DeliverableNoteSnapshots["Service"]["capture"]>[0] & {
      readonly anchor: DeliverableAnchor;
    },
  ) {
    const { anchor, deliverable, version } = input;
    const sha256 = version.contentSha256;
    if (anchor.kind === "time") {
      return deliverable.kind === "video" && (yield* blobs.has(sha256))
        ? { sourcePath: blobs.blobPath(sha256), seconds: Math.max(0, anchor.t) }
        : null;
    }
    const { output } = yield* renditions.get({ sha256, kind: deliverable.kind });
    const index = anchor.kind === "slide" ? anchor.index : 0;
    const image = output?.units.find((unit) => unit.index === index)?.image ?? null;
    return image === null
      ? null
      : { sourcePath: path.join(blobs.renditionDir({ sha256, kind: deliverable.kind }), image) };
  });

  const capture: DeliverableNoteSnapshots["Service"]["capture"] = Effect.fn(
    "DeliverableNoteSnapshots.capture",
  )(function* (input) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const picture = path.join(yield* blobs.scratchDir, "note.png");
        if (input.clientPicture !== null) {
          yield* fileSystem
            .writeFile(picture, input.clientPicture)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new DeliverableBlobStore.DeliverableBlobStoreError({ operation: "stage", cause }),
              ),
            );
          return yield* stored(picture);
        }
        const { anchor } = input;
        if (anchor === null) return null;
        // A note is worth keeping even when its picture cannot be made.
        const made = yield* Effect.gen(function* () {
          const source = yield* frameSource({ ...input, anchor });
          if (source === null) return false;
          yield* renderers.notePicture({ ...source, region: regionOf(anchor), outPath: picture });
          return true;
        }).pipe(
          Effect.catch((error) =>
            Effect.as(
              Effect.logWarning("Could not make the picture for a note", { error: error.message }),
              false,
            ),
          ),
        );
        return made ? yield* stored(picture) : null;
      }),
    );
  });

  return DeliverableNoteSnapshots.of({ capture });
});

export const layer = Layer.effect(DeliverableNoteSnapshots, make);
