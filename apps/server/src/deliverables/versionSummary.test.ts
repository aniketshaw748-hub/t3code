import { describe, expect, it } from "vite-plus/test";

import { versionSummary, versionSummarySource } from "./versionSummary.ts";

describe("versionSummary", () => {
  it.each([
    ["[Download the 3-slide deck](C:/Users/me/Work/deck.pptx)", "Download the 3-slide deck"],
    [
      "**Made the title slide bolder** and tightened the copy.",
      "Made the title slide bolder and tightened the copy.",
    ],
    ["## Done\n\nSwapped the intro.", "Done"],
    ["- Raised the _music_ under the outro", "Raised the music under the outro"],
    [
      String.raw`Saved the cut to C:\renders\film_v2.mp4. Next I can grade it.`,
      "Saved the cut to film_v2.mp4.",
    ],
    [
      "Rendered `/home/me/out/cut.mp4` with the new titles.",
      "Rendered cut.mp4 with the new titles.",
    ],
    ["Exported to ./out/deck-v2.pptx", "Exported to deck-v2.pptx"],
    ["Here is what changed:\n\n1. Slide 2 has the chart", "Here is what changed"],
    ["See https://example.com/x for the brief. Updated slide 3.", "See example.com for the brief."],
    ["```bash\nffmpeg -i in.mp4 out.mp4\n```\nTrimmed the first shot.", "Trimmed the first shot."],
    ["Kept snake_case_names and 3*4 math intact.", "Kept snake_case_names and 3*4 math intact."],
    ["Fixed the v2.1 build. It works now.", "Fixed the v2.1 build."],
  ])("reads %j as %j", (text, expected) => {
    expect(versionSummary(text)).toBe(expected);
  });

  it.each([[null], [""], ["   \n**\n"], ["[](C:/deck.pptx)"]])(
    "has nothing to say for %j",
    (text) => {
      expect(versionSummary(text)).toBeNull();
    },
  );

  it("trims a long sentence at a word", () => {
    const summary = versionSummary(`Changed ${"every slide ".repeat(40)}today`)!;
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary).toMatch(/^Changed every slide .*\w…$/);
  });

  it("keeps the full source text, capped", () => {
    expect(versionSummarySource("  **Bold** first.\nMore detail.  ")).toBe(
      "**Bold** first.\nMore detail.",
    );
    expect(versionSummarySource("x".repeat(4_010))!.length).toBe(4_000);
    expect(versionSummarySource("  ")).toBeNull();
  });
});
