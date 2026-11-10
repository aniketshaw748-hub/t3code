import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";
import * as PowerPointExport from "./powerPointExport.ts";

type Step = keyof typeof PowerPointExport.POWERPOINT_STEPS;
/** Stands in for one PowerShell script: works with the claim file as the real one does, then exits. */
type Script = (script: {
  readonly claim: string;
  /** Ends once the export has been asked to stop, which the real script sees as its stop file. */
  readonly stopAsked: Effect.Effect<void>;
}) => Effect.Effect<number, ProcessRunner.ProcessRunError>;

interface Run {
  readonly exporting: Effect.Effect<
    PowerPointExport.PowerPointExportResult,
    ProcessRunner.ProcessRunError
  >;
  /** The steps that ran, in order. */
  readonly ran: ReadonlyArray<Step>;
  readonly claim: string;
}

const output = (code: number): ProcessRunner.ProcessRunOutput => ({
  stdout: "",
  stderr: code === 0 ? "" : "PowerPoint said no.",
  code: code as ProcessRunner.ProcessRunOutput["code"],
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

/** Exports with `scripts` in place of PowerShell and PowerPoint; a step without one exits 0. */
const exportWith = <A, E>(
  scripts: Partial<Record<Step, Script>>,
  body: (run: Run) => Effect.Effect<A, E, FileSystem.FileSystem>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "powerpoint-export-" });
    const ran: Step[] = [];
    const stopAsked = yield* Deferred.make<void>();
    const watched: FileSystem.FileSystem = {
      ...fileSystem,
      writeFileString: (file, ...rest) =>
        fileSystem
          .writeFileString(file, ...rest)
          .pipe(
            Effect.tap(() =>
              file.endsWith("-stop") ? Deferred.succeed(stopAsked, undefined) : Effect.void,
            ),
          ),
    };
    const runner = ProcessRunner.ProcessRunner.of({
      run: (input) => {
        const step = (Object.keys(PowerPointExport.POWERPOINT_STEPS) as Step[]).find(
          (name) => PowerPointExport.POWERPOINT_STEPS[name].args === input.args,
        );
        if (input.command !== "powershell.exe" || step === undefined) {
          return Effect.die(new Error(`Unexpected command ${input.command}`));
        }
        ran.push(step);
        const script = scripts[step] ?? (() => Effect.succeed(0));
        return script({
          claim: input.env?.DELIVERABLE_CLAIM ?? "",
          stopAsked: Deferred.await(stopAsked),
        }).pipe(Effect.map(output));
      },
    });
    const powerPoint = yield* PowerPointExport.make({ stopGrace: "50 millis" }).pipe(
      Effect.provideService(ProcessRunner.ProcessRunner, runner),
      Effect.provideService(FileSystem.FileSystem, watched),
    );
    const claim = path.join(directory, "slides.powerpoint-claim");
    return yield* body({
      exporting: powerPoint.exportSlides({
        deckPath: path.join(directory, "deck.pptx"),
        outDir: path.join(directory, "slides"),
        claimPath: claim,
        slideWidth: 1280,
      }),
      ran,
      claim,
    });
  }).pipe(Effect.scoped);

/** What a script does with its files, as the real ones do. */
const files = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return {
    claimPowerPoint: (claim: string) => Effect.orDie(fileSystem.writeFileString(claim, "")),
    letGo: (claim: string) => Effect.orDie(fileSystem.remove(claim, { force: true })),
    exists: (file: string) => Effect.orDie(fileSystem.exists(file)),
  };
});

describe("powerPointExport", () => {
  it.live("leaves PowerPoint alone after an export that released it itself", () =>
    Effect.gen(function* () {
      const { claimPowerPoint, letGo, exists } = yield* files;
      yield* exportWith(
        {
          export: ({ claim }) =>
            claimPowerPoint(claim).pipe(Effect.andThen(letGo(claim)), Effect.as(0)),
        },
        (run) =>
          Effect.gen(function* () {
            assert.deepEqual(yield* run.exporting, { status: "exported" });
            assert.deepEqual(run.ran, ["export"]);
            assert.isFalse(yield* exists(run.claim));
          }),
      );
      yield* exportWith({ export: () => Effect.succeed(3) }, (run) =>
        Effect.gen(function* () {
          assert.deepEqual(yield* run.exporting, { status: "unavailable" });
          assert.deepEqual(run.ran, ["export"]);
        }),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("releases PowerPoint when the export fails or times out holding it", () =>
    Effect.gen(function* () {
      const { claimPowerPoint, letGo, exists } = yield* files;
      yield* exportWith(
        {
          export: ({ claim }) => Effect.as(claimPowerPoint(claim), 1),
          release: ({ claim }) => Effect.as(letGo(claim), 0),
        },
        (run) =>
          Effect.gen(function* () {
            assert.deepEqual(yield* run.exporting, {
              status: "failed",
              detail: "PowerPoint said no.",
            });
            assert.deepEqual(run.ran, ["export", "release"]);
            assert.isFalse(yield* exists(run.claim));
          }),
      );
      yield* exportWith(
        {
          export: ({ claim }) =>
            claimPowerPoint(claim).pipe(
              Effect.andThen(
                Effect.fail(
                  new ProcessRunner.ProcessTimeoutError({
                    command: "powershell.exe",
                    argumentCount: 6,
                    timeoutMs: 300_000,
                  }),
                ),
              ),
            ),
          release: ({ claim }) => Effect.as(letGo(claim), 0),
        },
        (run) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(run.exporting);
            assert.instanceOf(error, ProcessRunner.ProcessTimeoutError);
            assert.deepEqual(run.ran, ["export", "release"]);
            assert.isFalse(yield* exists(run.claim));
          }),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("asks an interrupted export to stop, and lets it release PowerPoint itself", () =>
    Effect.gen(function* () {
      const { claimPowerPoint, letGo, exists } = yield* files;
      const exportingSlides = yield* Deferred.make<void>();
      yield* exportWith(
        {
          // Between slides the script looks for the stop file, and lets PowerPoint go on seeing it.
          export: ({ claim, stopAsked }) =>
            Effect.gen(function* () {
              yield* claimPowerPoint(claim);
              yield* Deferred.succeed(exportingSlides, undefined);
              yield* stopAsked;
              yield* letGo(claim);
              return 1;
            }),
        },
        (run) =>
          Effect.gen(function* () {
            const fiber = yield* Effect.forkChild(run.exporting);
            yield* Deferred.await(exportingSlides);
            yield* Fiber.interrupt(fiber);
            assert.deepEqual(run.ran, ["export"]);
            assert.isFalse(yield* exists(run.claim));
            assert.isFalse(yield* exists(`${run.claim}-stop`));
          }),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live("releases PowerPoint itself when an interrupted export does not stop", () =>
    Effect.gen(function* () {
      const { claimPowerPoint, letGo, exists } = yield* files;
      const interrupted = (scripts: Partial<Record<Step, Script>>, expected: ReadonlyArray<Step>) =>
        Effect.gen(function* () {
          const exportingSlides = yield* Deferred.make<void>();
          yield* exportWith(
            {
              ...scripts,
              export: ({ claim }) =>
                claimPowerPoint(claim).pipe(
                  Effect.andThen(Deferred.succeed(exportingSlides, undefined)),
                  Effect.andThen(Effect.never),
                ),
            },
            (run) =>
              Effect.gen(function* () {
                const fiber = yield* Effect.forkChild(run.exporting);
                yield* Deferred.await(exportingSlides);
                yield* Fiber.interrupt(fiber);
                assert.deepEqual(run.ran, expected);
                assert.isFalse(yield* exists(run.claim));
              }),
          );
        });

      // PowerPoint answers: its presentation is closed and, when the export started it, it quits.
      yield* interrupted({ release: ({ claim }) => Effect.as(letGo(claim), 0) }, [
        "export",
        "release",
      ]);
      // PowerPoint does not answer, or will not go: the hidden one the export started is ended.
      yield* interrupted(
        { release: () => Effect.succeed(1), stop: ({ claim }) => Effect.as(letGo(claim), 0) },
        ["export", "release", "stop"],
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
