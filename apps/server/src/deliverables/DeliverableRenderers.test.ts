import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ProcessRunner from "../processRunner.ts";
import * as DeliverableRenderers from "./DeliverableRenderers.ts";

/** Whether ffmpeg is on this stand-in computer, and how often the renderers looked for it. */
const ffmpeg = { installed: false, looks: 0 };

const layerRunner = Layer.succeed(
  ProcessRunner.ProcessRunner,
  ProcessRunner.ProcessRunner.of({
    run: (input) =>
      Effect.sync(() => {
        if (input.command === "ffmpeg" && input.args[0] === "-version") ffmpeg.looks++;
        return {
          stdout: "",
          stderr: "",
          code: (ffmpeg.installed ? 0 : 1) as ProcessRunner.ProcessRunOutput["code"],
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        };
      }),
  }),
);

const layer = DeliverableRenderers.layer.pipe(
  Layer.provide(layerRunner),
  Layer.provide(NodeServices.layer),
);

it.layer(layer)("DeliverableRenderers", (it) => {
  it.effect("finds a tool installed while it runs: on a retry at once, else within a minute", () =>
    Effect.gen(function* () {
      const renderers = yield* DeliverableRenderers.DeliverableRenderers;
      const outline = renderers
        .outlineImage({ imagePath: "slide.png", outlinePath: "slide.rgb" })
        .pipe(
          Effect.as("made"),
          Effect.catchTags({
            DeliverableRenderUnsupportedError: () => Effect.succeed("no ffmpeg"),
          }),
        );

      assert.equal(yield* outline, "no ffmpeg");
      assert.equal(ffmpeg.looks, 1);

      // Installed now, but the answer is remembered: asking again costs no lookup.
      ffmpeg.installed = true;
      assert.equal(yield* outline, "no ffmpeg");
      assert.equal(ffmpeg.looks, 1);

      // "Render again" forgets the answer, so the next render looks and finds it.
      yield* renderers.recheckTools;
      assert.equal(yield* outline, "made");
      assert.equal(yield* outline, "made");
      assert.equal(ffmpeg.looks, 2);

      // Without a retry, an answer is believed for a minute and no longer.
      ffmpeg.installed = false;
      yield* TestClock.adjust("1 minute");
      assert.equal(yield* outline, "no ffmpeg");
      ffmpeg.installed = true;
      yield* TestClock.adjust("1 minute");
      assert.equal(yield* outline, "made");
      assert.equal(ffmpeg.looks, 4);
    }),
  );
});
