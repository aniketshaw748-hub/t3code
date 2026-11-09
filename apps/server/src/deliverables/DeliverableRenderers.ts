import type { DeliverableKind } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProcessRunner from "../processRunner.ts";
import { openZipArchive } from "../zipArchive.ts";
import {
  parseProbe,
  parseSceneCuts,
  pptxSlideOrder,
  pptxSlideReferences,
  pptxSlideTitle,
  shotsFromCuts,
} from "./mediaParsing.ts";
import { SIGNATURE_GRID } from "./perceptualDiff.ts";

/** The renderer cannot run here; `detail` says what to install. */
export class DeliverableRenderUnsupportedError extends Schema.TaggedError<DeliverableRenderUnsupportedError>()(
  "DeliverableRenderUnsupportedError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

export class DeliverableRenderError extends Schema.TaggedError<DeliverableRenderError>()(
  "DeliverableRenderError",
  {
    stage: Schema.Literals([
      "probe",
      "scenes",
      "frames",
      "proxy",
      "slides",
      "structure",
      "signature",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Rendering failed while extracting ${this.stage}.`;
  }
}

export const RenderedUnit = Schema.Struct({
  index: Schema.Number,
  kind: Schema.Literals(["slide", "shot", "page", "image"]),
  start: Schema.optional(Schema.Number),
  end: Schema.optional(Schema.Number),
  title: Schema.optional(Schema.String),
  /** File names inside the rendition directory. */
  image: Schema.NullOr(Schema.String),
  thumb: Schema.NullOr(Schema.String),
  /** A SIGNATURE_GRID² RGB file, or a structural hash when nothing was rendered. */
  signature: Schema.NullOr(
    Schema.Union([Schema.Struct({ file: Schema.String }), Schema.Struct({ hash: Schema.String })]),
  ),
});
export type RenderedUnit = typeof RenderedUnit.Type;

export const RenderOutput = Schema.Struct({
  renderer: Schema.String,
  width: Schema.NullOr(Schema.Number),
  height: Schema.NullOr(Schema.Number),
  durationSeconds: Schema.NullOr(Schema.Number),
  poster: Schema.NullOr(Schema.String),
  proxy: Schema.NullOr(Schema.String),
  units: Schema.Array(RenderedUnit),
  /** Frames sampled across a video at `fps`, SIGNATURE_BYTES each. */
  samples: Schema.NullOr(Schema.Struct({ file: Schema.String, fps: Schema.Number })),
  /** What this rendition could not do, such as slide images without a slide renderer. */
  detail: Schema.NullOr(Schema.String),
});
export type RenderOutput = typeof RenderOutput.Type;

/** One interface over per-kind renderers. Each writes its files into `outDir`. */
export class DeliverableRenderers extends Context.Service<
  DeliverableRenderers,
  {
    readonly render: (input: {
      readonly kind: DeliverableKind;
      readonly sourcePath: string;
      /** The file's real name; the stored blob has none. */
      readonly fileName: string;
      readonly outDir: string;
      readonly scratchDir: string;
    }) => Effect.Effect<RenderOutput, DeliverableRenderUnsupportedError | DeliverableRenderError>;
  }
>()("t3/deliverables/DeliverableRenderers") {}

const FFMPEG_MISSING =
  "ffmpeg and ffprobe are not on PATH. Install ffmpeg (winget install Gyan.FFmpeg, brew install ffmpeg, or apt install ffmpeg) and restart the server.";
const SLIDE_RENDERER_MISSING =
  "Slide images need Microsoft PowerPoint (Windows) or LibreOffice with Poppler's pdftoppm (winget install TheDocumentFoundation.LibreOffice, brew install --cask libreoffice && brew install poppler, or apt install libreoffice poppler-utils). Slides are compared by their file structure until then.";
const PDF_RENDERER_MISSING =
  "PDF pages need Poppler's pdftoppm (brew install poppler, apt install poppler-utils, or a Poppler build for Windows on PATH).";

const SAMPLE_BUDGET = 1_200;
const KEYFRAME_WIDTH = 960;
const THUMB_WIDTH = 240;
const SLIDE_WIDTH = 1280;
const unitName = (prefix: string, index: number, suffix: string) =>
  `${prefix}-${String(index + 1).padStart(4, "0")}${suffix}`;

const POWERPOINT_SCRIPT = `
$ErrorActionPreference = 'Stop'
try { $app = New-Object -ComObject PowerPoint.Application } catch { exit 3 }
$pres = $app.Presentations.Open($env:DELIVERABLE_INPUT, -1, 0, 0)
try {
  $height = [int](${SLIDE_WIDTH} * $pres.PageSetup.SlideHeight / $pres.PageSetup.SlideWidth)
  foreach ($slide in $pres.Slides) {
    $name = 'slide-{0:D4}.png' -f $slide.SlideIndex
    $slide.Export((Join-Path $env:DELIVERABLE_OUTPUT $name), 'PNG', ${SLIDE_WIDTH}, $height)
  }
} finally {
  $pres.Close()
  if ($app.Presentations.Count -eq 0) { $app.Quit() }
}
`;

const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;

  const run = (
    command: string,
    args: ReadonlyArray<string>,
    options: { readonly env?: NodeJS.ProcessEnv; readonly timeout?: Duration.Input } = {},
  ) =>
    runner.run({
      command,
      args,
      timeout: options.timeout ?? "10 minutes",
      ...(options.env === undefined ? {} : { env: options.env }),
    });

  const available = (command: string, args: ReadonlyArray<string>) =>
    run(command, args, { timeout: "20 seconds" }).pipe(
      Effect.map((result) => result.code === 0),
      Effect.orElseSucceed(() => false),
    );
  const ffmpegAvailable = yield* Effect.cached(
    Effect.zipWith(
      available("ffmpeg", ["-version"]),
      available("ffprobe", ["-version"]),
      (a, b) => a && b,
    ),
  );
  const pdftoppmAvailable = yield* Effect.cached(available("pdftoppm", ["-v"]));
  const sofficePath = yield* Effect.cached(
    Effect.gen(function* () {
      if (yield* available("soffice", ["--version"])) return Option.some("soffice");
      const candidates =
        platform === "win32"
          ? ["C:\\Program Files\\LibreOffice\\program\\soffice.exe"]
          : platform === "darwin"
            ? ["/Applications/LibreOffice.app/Contents/MacOS/soffice"]
            : [];
      for (const candidate of candidates) {
        if (yield* fileSystem.exists(candidate).pipe(Effect.orElseSucceed(() => false))) {
          return Option.some(candidate);
        }
      }
      return Option.none<string>();
    }),
  );

  const requireFfmpeg = Effect.flatMap(ffmpegAvailable, (ok) =>
    ok
      ? Effect.void
      : Effect.fail(new DeliverableRenderUnsupportedError({ detail: FFMPEG_MISSING })),
  );

  const ffmpeg = (stage: DeliverableRenderError["stage"], args: ReadonlyArray<string>) =>
    run("ffmpeg", ["-hide_banner", "-nostdin", "-y", ...args]).pipe(
      Effect.mapError((cause) => new DeliverableRenderError({ stage, cause })),
      Effect.filterOrFail(
        (result) => result.code === 0,
        (result) => new DeliverableRenderError({ stage, cause: result.stderr.slice(-2_000) }),
      ),
    );

  const probe = Effect.fn("DeliverableRenderers.probe")(function* (file: string) {
    const result = yield* run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,width,height",
      "-of",
      "json",
      file,
    ]).pipe(Effect.mapError((cause) => new DeliverableRenderError({ stage: "probe", cause })));
    const probed = parseProbe(result.stdout);
    if (probed === null)
      return yield* new DeliverableRenderError({ stage: "probe", cause: result.stderr });
    return probed;
  });

  const scaleFilter = (width: number) => `scale='min(${width},iw)':-2:flags=lanczos`;
  const signatureFilter = `scale=${SIGNATURE_GRID}:${SIGNATURE_GRID}:flags=area,format=rgb24`;

  /** A still image's display copy, thumbnail and pixel signature. */
  const stillUnit = Effect.fn("DeliverableRenderers.stillUnit")(function* (
    source: string,
    outDir: string,
    prefix: string,
    index: number,
    width: number,
  ) {
    const image = unitName(prefix, index, ".jpg");
    const thumb = unitName(prefix, index, "-thumb.jpg");
    const signature = unitName(prefix, index, ".rgb");
    yield* ffmpeg("frames", [
      "-v",
      "error",
      "-i",
      source,
      "-vf",
      scaleFilter(width),
      "-q:v",
      "3",
      path.join(outDir, image),
    ]);
    yield* ffmpeg("frames", [
      "-v",
      "error",
      "-i",
      source,
      "-vf",
      scaleFilter(THUMB_WIDTH),
      "-q:v",
      "4",
      path.join(outDir, thumb),
    ]);
    yield* ffmpeg("signature", [
      "-v",
      "error",
      "-i",
      source,
      "-vf",
      signatureFilter,
      "-f",
      "rawvideo",
      path.join(outDir, signature),
    ]);
    return { image, thumb, signature: { file: signature } } as const;
  });

  const renderVideo = Effect.fn("DeliverableRenderers.renderVideo")(function* (
    sourcePath: string,
    outDir: string,
  ) {
    yield* requireFfmpeg;
    const probed = yield* probe(sourcePath);
    if (!probed.hasVideo || probed.durationSeconds === null) {
      return yield* new DeliverableRenderError({
        stage: "probe",
        cause: "No video stream with a duration.",
      });
    }
    const duration = probed.durationSeconds;
    const scenes = yield* ffmpeg("scenes", [
      "-i",
      sourcePath,
      "-vf",
      "select='gt(scene,0.3)',showinfo",
      "-an",
      "-f",
      "null",
      "-",
    ]);
    const shots = shotsFromCuts(parseSceneCuts(scenes.stderr), duration);
    const fps = Math.min(2, SAMPLE_BUDGET / duration);
    yield* ffmpeg("signature", [
      "-v",
      "error",
      "-i",
      sourcePath,
      "-vf",
      `fps=${fps.toFixed(4)},${signatureFilter}`,
      "-f",
      "rawvideo",
      path.join(outDir, "samples.rgb"),
    ]);
    const units: RenderedUnit[] = [];
    for (const shot of shots) {
      const middle = ((shot.start + shot.end) / 2).toFixed(3);
      const image = unitName("shot", shot.index, ".jpg");
      const thumb = unitName("shot", shot.index, "-thumb.jpg");
      for (const [file, width] of [
        [image, KEYFRAME_WIDTH],
        [thumb, THUMB_WIDTH],
      ] as const) {
        yield* ffmpeg("frames", [
          "-v",
          "error",
          "-ss",
          middle,
          "-i",
          sourcePath,
          "-frames:v",
          "1",
          "-vf",
          scaleFilter(width),
          "-q:v",
          "3",
          path.join(outDir, file),
        ]);
      }
      units.push({
        index: shot.index,
        kind: "shot",
        start: shot.start,
        end: shot.end,
        image,
        thumb,
        signature: null,
      });
    }
    yield* ffmpeg("proxy", [
      "-v",
      "error",
      "-i",
      sourcePath,
      "-vf",
      "scale=-2:'min(360,ih)'",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "30",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-movflags",
      "+faststart",
      path.join(outDir, "proxy.mp4"),
    ]);
    return {
      renderer: "video-ffmpeg@2",
      width: probed.width,
      height: probed.height,
      durationSeconds: duration,
      poster: units[0]?.image ?? null,
      proxy: "proxy.mp4",
      units,
      samples: { file: "samples.rgb", fps },
      detail: null,
    } satisfies RenderOutput;
  });

  /** Slide order, titles and per-slide content hashes from the pptx package itself. */
  const pptxStructure = Effect.fn("DeliverableRenderers.pptxStructure")(function* (
    sourcePath: string,
  ) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const archive = yield* openZipArchive(
          sourcePath,
          (detail, cause) =>
            new DeliverableRenderError({ stage: "structure", cause: { detail, cause } }),
        );
        const texts = new Map<string, string>();
        const fingerprints = new Map<string, string>();
        for (let entry = yield* archive.next; entry !== null; entry = yield* archive.next) {
          fingerprints.set(entry.fileName, `${entry.crc32}:${entry.uncompressedSize}`);
          if (!entry.fileName.endsWith(".xml") && !entry.fileName.endsWith(".rels")) continue;
          if (entry.uncompressedSize > 8 * 1024 * 1024) continue;
          const readable = yield* archive.streamEntry(entry);
          const chunks: Uint8Array[] = [];
          yield* Effect.callback<void, DeliverableRenderError>((resume) => {
            readable.on("data", (chunk: Uint8Array) => chunks.push(chunk));
            readable.once("end", () => resume(Effect.void));
            readable.once("error", (cause) =>
              resume(Effect.fail(new DeliverableRenderError({ stage: "structure", cause }))),
            );
          });
          texts.set(entry.fileName, Buffer.concat(chunks).toString("utf8"));
        }
        const slides = pptxSlideOrder(
          texts.get("ppt/presentation.xml") ?? "",
          texts.get("ppt/_rels/presentation.xml.rels") ?? "",
        );
        return slides.map((slide) => {
          const relsPath = `${slide.slice(0, slide.lastIndexOf("/"))}/_rels/${slide.slice(slide.lastIndexOf("/") + 1)}.rels`;
          const references = pptxSlideReferences(slide, texts.get(relsPath) ?? "");
          const xml = texts.get(slide) ?? "";
          const hash = [
            fingerprints.get(slide),
            ...references.map((ref) => `${ref}=${fingerprints.get(ref) ?? "?"}`),
          ].join("|");
          return { title: pptxSlideTitle(xml), hash };
        });
      }),
    );
  });

  /** Slide images from PowerPoint over COM, or from LibreOffice and pdftoppm; none when neither exists. */
  const slideImages = Effect.fn("DeliverableRenderers.slideImages")(function* (
    sourcePath: string,
    scratchDir: string,
  ) {
    const listPngs = fileSystem.readDirectory(scratchDir).pipe(
      Effect.map((names) => names.filter((name) => name.endsWith(".png")).sort()),
      Effect.mapError((cause) => new DeliverableRenderError({ stage: "slides", cause })),
    );
    if (platform === "win32") {
      const result = yield* run(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", POWERPOINT_SCRIPT],
        {
          env: { DELIVERABLE_INPUT: sourcePath, DELIVERABLE_OUTPUT: scratchDir },
          timeout: "5 minutes",
        },
      ).pipe(Effect.mapError((cause) => new DeliverableRenderError({ stage: "slides", cause })));
      if (result.code === 0) return { renderer: "deck-powerpoint@2", files: yield* listPngs };
      if (result.code !== 3)
        return yield* new DeliverableRenderError({
          stage: "slides",
          cause: result.stderr.slice(-2_000),
        });
    }
    const soffice = yield* sofficePath;
    if (Option.isNone(soffice) || !(yield* pdftoppmAvailable)) return null;
    const converted = yield* run(soffice.value, [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      scratchDir,
      sourcePath,
    ]).pipe(Effect.mapError((cause) => new DeliverableRenderError({ stage: "slides", cause })));
    const pdf = path.join(scratchDir, `${path.basename(sourcePath, path.extname(sourcePath))}.pdf`);
    if (
      converted.code !== 0 ||
      !(yield* fileSystem.exists(pdf).pipe(Effect.orElseSucceed(() => false)))
    ) {
      return yield* new DeliverableRenderError({
        stage: "slides",
        cause: converted.stderr.slice(-2_000),
      });
    }
    yield* rasterizePdf(pdf, scratchDir);
    return { renderer: "deck-libreoffice@2", files: yield* listPngs };
  });

  const rasterizePdf = (pdf: string, scratchDir: string) =>
    run("pdftoppm", [
      "-png",
      "-scale-to",
      String(SLIDE_WIDTH),
      pdf,
      path.join(scratchDir, "page"),
    ]).pipe(
      Effect.mapError((cause) => new DeliverableRenderError({ stage: "slides", cause })),
      Effect.filterOrFail(
        (result) => result.code === 0,
        (result) =>
          new DeliverableRenderError({ stage: "slides", cause: result.stderr.slice(-2_000) }),
      ),
      Effect.asVoid,
    );

  const renderDeck = Effect.fn("DeliverableRenderers.renderDeck")(function* (
    sourcePath: string,
    fileName: string,
    outDir: string,
    scratchDir: string,
  ) {
    const isPptx = fileName.toLowerCase().endsWith(".pptx");
    const structure = isPptx ? yield* pptxStructure(sourcePath) : [];
    // PowerPoint and LibreOffice pick the importer from the extension, which the blob lacks.
    const named = path.join(scratchDir, `deck${path.extname(fileName)}`);
    yield* fileSystem
      .copyFile(sourcePath, named)
      .pipe(Effect.mapError((cause) => new DeliverableRenderError({ stage: "slides", cause })));
    const slidesDir = path.join(scratchDir, "slides");
    yield* fileSystem
      .makeDirectory(slidesDir)
      .pipe(Effect.mapError((cause) => new DeliverableRenderError({ stage: "slides", cause })));
    const images = (yield* ffmpegAvailable) ? yield* slideImages(named, slidesDir) : null;
    if (images === null || images.files.length === 0) {
      if (structure.length === 0) {
        return yield* new DeliverableRenderUnsupportedError({
          detail: (yield* ffmpegAvailable)
            ? SLIDE_RENDERER_MISSING
            : `${FFMPEG_MISSING} ${SLIDE_RENDERER_MISSING}`,
        });
      }
      return {
        renderer: "deck-structure@1",
        width: null,
        height: null,
        durationSeconds: null,
        poster: null,
        proxy: null,
        units: structure.map((slide, index) => ({
          index,
          kind: "slide" as const,
          ...(slide.title === undefined ? {} : { title: slide.title }),
          image: null,
          thumb: null,
          signature: { hash: slide.hash },
        })),
        samples: null,
        detail: (yield* ffmpegAvailable)
          ? SLIDE_RENDERER_MISSING
          : `${FFMPEG_MISSING} ${SLIDE_RENDERER_MISSING}`,
      } satisfies RenderOutput;
    }
    const units: RenderedUnit[] = [];
    for (const [index, file] of images.files.entries()) {
      const still = yield* stillUnit(
        path.join(slidesDir, file),
        outDir,
        "slide",
        index,
        SLIDE_WIDTH,
      );
      const title = structure[index]?.title;
      units.push({ index, kind: "slide", ...(title === undefined ? {} : { title }), ...still });
    }
    const first = yield* probe(path.join(slidesDir, images.files[0]!));
    return {
      renderer: images.renderer,
      width: first.width,
      height: first.height,
      durationSeconds: null,
      poster: units[0]?.image ?? null,
      proxy: null,
      units,
      samples: null,
      detail: null,
    } satisfies RenderOutput;
  });

  const renderPdf = Effect.fn("DeliverableRenderers.renderPdf")(function* (
    sourcePath: string,
    outDir: string,
    scratchDir: string,
  ) {
    yield* requireFfmpeg;
    if (!(yield* pdftoppmAvailable))
      return yield* new DeliverableRenderUnsupportedError({ detail: PDF_RENDERER_MISSING });
    yield* rasterizePdf(sourcePath, scratchDir);
    const pages = (yield* fileSystem
      .readDirectory(scratchDir)
      .pipe(Effect.mapError((cause) => new DeliverableRenderError({ stage: "slides", cause }))))
      .filter((name) => name.startsWith("page") && name.endsWith(".png"))
      .sort();
    const units: RenderedUnit[] = [];
    for (const [index, file] of pages.entries()) {
      units.push({
        index,
        kind: "page",
        ...(yield* stillUnit(path.join(scratchDir, file), outDir, "page", index, SLIDE_WIDTH)),
      });
    }
    return {
      renderer: "pdf-pdftoppm@2",
      width: null,
      height: null,
      durationSeconds: null,
      poster: units[0]?.image ?? null,
      proxy: null,
      units,
      samples: null,
      detail: null,
    } satisfies RenderOutput;
  });

  const renderImage = Effect.fn("DeliverableRenderers.renderImage")(function* (
    sourcePath: string,
    outDir: string,
  ) {
    yield* requireFfmpeg;
    const probed = yield* probe(sourcePath);
    const still = yield* stillUnit(sourcePath, outDir, "image", 0, 1_600);
    return {
      renderer: "image-ffmpeg@2",
      width: probed.width,
      height: probed.height,
      durationSeconds: null,
      poster: still.image,
      proxy: null,
      units: [{ index: 0, kind: "image", ...still }],
      samples: null,
      detail: null,
    } satisfies RenderOutput;
  });

  return DeliverableRenderers.of({
    render: Effect.fn("DeliverableRenderers.render")(function* (input) {
      yield* Effect.annotateCurrentSpan({ "deliverable.kind": input.kind });
      yield* fileSystem
        .makeDirectory(input.outDir, { recursive: true })
        .pipe(Effect.mapError((cause) => new DeliverableRenderError({ stage: "frames", cause })));
      switch (input.kind) {
        case "video":
          return yield* renderVideo(input.sourcePath, input.outDir);
        case "deck":
          return yield* renderDeck(
            input.sourcePath,
            input.fileName,
            input.outDir,
            input.scratchDir,
          );
        case "pdf":
          return yield* renderPdf(input.sourcePath, input.outDir, input.scratchDir);
        case "image":
          return yield* renderImage(input.sourcePath, input.outDir);
        case "other":
          return yield* new DeliverableRenderUnsupportedError({
            detail: "This file type has no renderer.",
          });
      }
    }),
  });
});

export const layer = Layer.effect(DeliverableRenderers, make);
