import { describe, expect, it } from "vite-plus/test";

import { strayVersionTarget } from "./strayVersions.ts";

const deliverables = [
  { path: "presentation.pptx" },
  { path: "film/cut.mp4" },
  { path: "brief-v1.pdf" },
];

describe("strayVersionTarget", () => {
  it.each([
    ["presentation-v2.pptx", "presentation.pptx"],
    ["presentation_V3.PPTX", "presentation.pptx"],
    ["presentation (2).pptx", "presentation.pptx"],
    ["presentation_final.pptx", "presentation.pptx"],
    ["presentation-revised-v2.pptx", "presentation.pptx"],
    ["film/cut v2.mp4", "film/cut.mp4"],
    ["brief-v2.pdf", "brief-v1.pdf"],
  ])("reads %s as a revision of %s", (path, target) => {
    expect(strayVersionTarget(path, deliverables)?.path).toBe(target);
  });

  it.each([
    // No suffix of its own, so it is a different file.
    "pitch.pptx",
    "presentation.pptx",
    // A different folder or kind of file.
    "old/presentation-v2.pptx",
    "presentation-v2.pdf",
    "cut-v2.mp4",
    // Numbered parts are separate files, not versions.
    "presentation-2.pptx",
  ])("leaves %s alone", (path) => {
    expect(strayVersionTarget(path, deliverables)).toBeNull();
  });

  it("offers nothing when two deliverables could be the original", () => {
    expect(
      strayVersionTarget("deck-v3.pptx", [{ path: "deck.pptx" }, { path: "deck-v2.pptx" }]),
    ).toBeNull();
  });
});
