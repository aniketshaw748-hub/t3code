import { describe, expect, it } from "vite-plus/test";

import { agentPreviewLines, agentPreviewText } from "./agentPreviewText.ts";

describe("agentPreviewText", () => {
  it.each([
    [
      "Saved [film.mp4](C:/Users/me/Work/New video/film.mp4) using your exact command.",
      "Saved film.mp4 using your exact command.",
    ],
    [
      "Saved [film.mp4] (C:/Users/me/Work/film.mp4) using your exact command.",
      "Saved film.mp4 using your exact command.",
    ],
    ["See note [1] (page 4) for the source.", "See note [1] (page 4) for the source."],
    ["![Title slide](./out/slide-1.png) is ready.", "Title slide is ready."],
    ["Read the [brief][1] first.", "Read the brief first."],
    [
      String.raw`Saved the cut to C:\renders\film_v2.mp4. Next I can grade it.`,
      "Saved the cut to film_v2.mp4. Next I can grade it.",
    ],
    [
      "Rendered `/home/me/out/cut.mp4` with the new titles.",
      "Rendered cut.mp4 with the new titles.",
    ],
    [
      String.raw`Wrote "C:\Users\Jane Doe\deck final.pptx" for you.`,
      'Wrote "deck final.pptx" for you.',
    ],
    [
      "Exported to ./out/deck-v2.pptx and ~/Desktop/deck.pdf.",
      "Exported to deck-v2.pptx and deck.pdf.",
    ],
    ["Open <file:///C:/renders/first%20cut.mp4> to watch.", "Open first cut.mp4 to watch."],
    ["See https://www.example.com/briefs/7 for the brief.", "See example.com for the brief."],
    ["Pick slides and/or shots at 1/2 speed.", "Pick slides and/or shots at 1/2 speed."],
    [
      "**Made the title bolder** and _tightened_ the `copy`.",
      "Made the title bolder and tightened the copy.",
    ],
    ["Kept snake_case_names and 3*4 math intact.", "Kept snake_case_names and 3*4 math intact."],
    [
      "Fixed the subtitle and marked note note_31e785d4b4c7457ebde861049769d77a as fixed.",
      "Fixed the subtitle and marked the note as fixed.",
    ],
    ["Saved version (ver_0123456789abcdef0123) of the deck.", "Saved version of the deck."],
    ["## Done", "Done"],
    ["> - [x] Raised the music", "Raised the music"],
    ["| Slide | Change |", "Slide · Change"],
  ])("reads %j as %j", (markdown, expected) => {
    expect(agentPreviewText(markdown)).toBe(expected);
  });

  it("keeps one readable line per source line and leaves code blocks out", () => {
    expect(
      agentPreviewLines(
        "Here is what changed:\n\n1. Slide 2 has the chart\n2. **Slide 3** is shorter\n\n---\n\n```bash\nffmpeg -i in.mp4 out.mp4\n```\nTrimmed the first shot.",
      ),
    ).toEqual([
      "Here is what changed:",
      "Slide 2 has the chart",
      "Slide 3 is shorter",
      "Trimmed the first shot.",
    ]);
  });

  it.each([[null], [undefined], [""], ["   \n**\n"], ["[](C:/deck.pptx)"]])(
    "has nothing to show for %j",
    (markdown) => {
      expect(agentPreviewText(markdown)).toBe("");
    },
  );
});
