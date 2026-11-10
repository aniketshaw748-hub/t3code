/**
 * Slide images from PowerPoint on Windows. PowerPoint runs once per session: COM hands back the
 * one the user has open and starts a hidden one only when there is none. So an export closes only
 * the presentation it opened, and ends only a PowerPoint it started that is hidden and holds nothing.
 */
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";

import * as ProcessRunner from "../processRunner.ts";

/** The export script's exit code when this computer has no PowerPoint. */
const NO_POWERPOINT = 3;

// The claim file lists the PowerPoint processes running before the export asked for one; it is
// taken away once PowerPoint is seen to be let go. Quit only works once nothing refers to
// PowerPoint, so the work is in functions whose references end with them, and a PowerPoint whose
// script was ended mid-call ignores it: that claim stays, for the stop step.
const PRELUDE = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Get-PowerPointIds {
  @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
}
function Get-StartedIds {
  $before = @([IO.File]::ReadAllLines($env:DELIVERABLE_CLAIM))
  @(Get-PowerPointIds | Where-Object { $before -notcontains "$_" })
}
# True when PowerPoint is this export's to end: it started after the export began, nothing else is
# open in it and it shows no window. A user who opens a deck in it makes it theirs.
function Close-ExportedDeck($app) {
  $opened = @($app.Presentations | Where-Object { $_.FullName -eq $env:DELIVERABLE_INPUT })
  foreach ($presentation in $opened) { $presentation.Close() }
  @(Get-StartedIds).Count -gt 0 -and $app.Presentations.Count -eq 0 -and $app.Visible -eq 0
}
function Release-PowerPoint($app) {
  if (Close-ExportedDeck $app) {
    $app.Quit()
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
    Wait-Process -Id (Get-StartedIds) -Timeout 8 -ErrorAction SilentlyContinue
    if (@(Get-StartedIds).Count -gt 0) { return }
  }
  Remove-Item -LiteralPath $env:DELIVERABLE_CLAIM
}
`;

const EXPORT_SCRIPT = `${PRELUDE}
function Export-Slides($app) {
  $presentation = $app.Presentations.Open($env:DELIVERABLE_INPUT, -1, 0, 0)
  $width = [int]$env:DELIVERABLE_WIDTH
  $height = [int]($width * $presentation.PageSetup.SlideHeight / $presentation.PageSetup.SlideWidth)
  foreach ($slide in $presentation.Slides) {
    if (Test-Path -LiteralPath $env:DELIVERABLE_STOP) { throw 'The export was asked to stop.' }
    $name = 'slide-{0:D4}.png' -f $slide.SlideIndex
    $slide.Export((Join-Path $env:DELIVERABLE_OUTPUT $name), 'PNG', $width, $height)
  }
}
[IO.File]::WriteAllLines($env:DELIVERABLE_CLAIM, [string[]]@(Get-PowerPointIds))
try { $app = New-Object -ComObject PowerPoint.Application } catch {
  Remove-Item -LiteralPath $env:DELIVERABLE_CLAIM
  exit ${NO_POWERPOINT}
}
try { Export-Slides $app } finally { Release-PowerPoint $app }
`;

// With no PowerPoint running nothing is held, and asking COM for one would only start it.
const RELEASE_SCRIPT = `${PRELUDE}
if (@(Get-PowerPointIds).Count -eq 0) {
  Remove-Item -LiteralPath $env:DELIVERABLE_CLAIM
  exit 0
}
Release-PowerPoint (New-Object -ComObject PowerPoint.Application)
`;

// For a PowerPoint that does not answer or will not go. It is ended only if it started after the
// export began, was started for automation and shows no window: one the user started, or has
// since opened a deck in, is left alone.
const STOP_SCRIPT = `${PRELUDE}
foreach ($id in Get-StartedIds) {
  $started = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
  $shown = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($null -eq $started -or $null -eq $shown) { continue }
  if ($started.CommandLine -match '(?i)[-/]embedding' -and $shown.MainWindowHandle -eq [IntPtr]::Zero) {
    Stop-Process -Id $id -Force
  }
}
Remove-Item -LiteralPath $env:DELIVERABLE_CLAIM
`;

/** PowerShell arguments that run `script`; encoded, so no quoting of it can go wrong. */
const powerShellArgs = (script: string): ReadonlyArray<string> => [
  "-NoProfile",
  "-NonInteractive",
  "-OutputFormat",
  "Text",
  "-EncodedCommand",
  Buffer.from(script, "utf16le").toString("base64"),
];

/** What each step runs: the export, then how PowerPoint is let go when the export was stopped. */
export const POWERPOINT_STEPS = {
  export: { args: powerShellArgs(EXPORT_SCRIPT), timeout: "5 minutes" },
  /** Asks PowerPoint to close the export's presentation, and to quit when the export started it. */
  release: { args: powerShellArgs(RELEASE_SCRIPT), timeout: "1 minute" },
  /** Ends a hidden PowerPoint the export started that did not answer the release or go on Quit. */
  stop: { args: powerShellArgs(STOP_SCRIPT), timeout: "30 seconds" },
} as const;

export interface PowerPointExportInput {
  /** The deck under a name with its extension, which PowerPoint picks the importer from. */
  readonly deckPath: string;
  /** Where the slide images go, one PNG a slide. */
  readonly outDir: string;
  /** A file of this export's own, outside `outDir`; its stop file sits beside it. */
  readonly claimPath: string;
  readonly slideWidth: number;
}

export type PowerPointExportResult =
  | { readonly status: "exported" }
  /** This computer has no PowerPoint. */
  | { readonly status: "unavailable" }
  | { readonly status: "failed"; readonly detail: string };

export interface PowerPointExportOptions {
  /** How long an interrupted export has to stop by itself; exporting one slide takes far less. */
  readonly stopGrace: Duration.Input;
}

export const make = Effect.fn("PowerPointExport.make")(function* (
  options: PowerPointExportOptions = { stopGrace: "15 seconds" },
) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const fileSystem = yield* FileSystem.FileSystem;

  const stopPath = (input: PowerPointExportInput) => `${input.claimPath}-stop`;
  const step = (name: keyof typeof POWERPOINT_STEPS, input: PowerPointExportInput) =>
    runner.run({
      command: "powershell.exe",
      ...POWERPOINT_STEPS[name],
      env: {
        DELIVERABLE_INPUT: input.deckPath,
        DELIVERABLE_OUTPUT: input.outDir,
        DELIVERABLE_CLAIM: input.claimPath,
        DELIVERABLE_STOP: stopPath(input),
        DELIVERABLE_WIDTH: String(input.slideWidth),
      },
    });

  /** Lets PowerPoint go for an export whose script ended with its claim still there. */
  const release = Effect.fn("PowerPointExport.release")(function* (input: PowerPointExportInput) {
    const claimed = fileSystem.exists(input.claimPath).pipe(Effect.orElseSucceed(() => false));
    for (const name of ["release", "stop"] as const) {
      if (!(yield* claimed)) return;
      yield* Effect.ignore(step(name, input));
    }
    if (yield* claimed) {
      yield* Effect.logWarning("PowerPoint may still hold a deck whose export was stopped", {
        deckPath: input.deckPath,
      });
    }
  });

  // Asked to stop, the script lets PowerPoint go itself before its next slide. Ending it mid-call
  // instead leaves that PowerPoint running hidden after its last window closes, and it may be the
  // user's. So an interruption asks first, and ends the script only when it has not stopped in time.
  const runExport = (input: PowerPointExportInput) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.flatMap(Effect.forkChild(restore(step("export", input))), (script) =>
        restore(Fiber.join(script)).pipe(
          Effect.onInterrupt(() =>
            fileSystem
              .writeFileString(stopPath(input), "")
              .pipe(
                Effect.andThen(Fiber.await(script)),
                Effect.timeoutOption(options.stopGrace),
                Effect.ignore,
                Effect.andThen(Fiber.interrupt(script)),
              ),
          ),
        ),
      ),
    );

  const exportSlides = (input: PowerPointExportInput) =>
    runExport(input).pipe(
      Effect.map((result): PowerPointExportResult => {
        if (result.code === 0) return { status: "exported" };
        if (result.code === NO_POWERPOINT) return { status: "unavailable" };
        return { status: "failed", detail: result.stderr.slice(-2_000) };
      }),
      Effect.ensuring(release(input)),
      Effect.ensuring(Effect.ignore(fileSystem.remove(stopPath(input), { force: true }))),
    );

  return { exportSlides };
});
