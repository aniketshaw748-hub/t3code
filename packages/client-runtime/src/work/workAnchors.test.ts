import { describe, expect, it } from "vite-plus/test";

import {
  anchorFrameUrl,
  changeRegion,
  compareUnitLabel,
  noteAnchorChip,
  notePinAnchor,
  notePinLabel,
  renditionMeta,
  spendApprovalDetails,
} from "./workAnchors.ts";

describe("note pinning", () => {
  const region = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
  it.each([
    [
      "video at the playhead",
      { kind: "video", playheadSeconds: 42.5, selectedSlide: null },
      "0:42",
    ],
    ["the selected slide", { kind: "deck", playheadSeconds: 0, selectedSlide: 2 }, "Slide 3"],
    ["a pdf page", { kind: "pdf", playheadSeconds: 0, selectedSlide: 0 }, "Page 1"],
    [
      "a deck with no slide picked",
      { kind: "deck", playheadSeconds: 0, selectedSlide: null },
      null,
    ],
  ] as const)("labels %s", (_name, target, label) => {
    expect(notePinLabel({ ...target, region: null })).toBe(label);
  });

  it("pins to the playhead or slide, keeps a drawn region, and drops the pin when asked", () => {
    const video = { kind: "video", playheadSeconds: 12, selectedSlide: null, region } as const;
    expect(notePinAnchor(video, true)).toEqual({ kind: "time", t: 12, region });
    expect(notePinAnchor(video, false)).toBeNull();
    expect(
      notePinAnchor({ kind: "deck", playheadSeconds: 0, selectedSlide: 4, region: null }, true),
    ).toEqual({ kind: "slide", index: 4 });
    expect(
      notePinAnchor({ kind: "image", playheadSeconds: 0, selectedSlide: null, region }, true),
    ).toEqual({ kind: "region", ...region });
    expect(
      notePinAnchor({ kind: "deck", playheadSeconds: 0, selectedSlide: null, region: null }, true),
    ).toBeNull();
  });

  it("names where a note points on its card", () => {
    expect(noteAnchorChip(null, "video")).toBe("Whole video");
    expect(noteAnchorChip({ kind: "time", t: 64 }, "video")).toBe("1:04");
    expect(noteAnchorChip({ kind: "slide", index: 1 }, "pdf")).toBe("Page 2");
    expect(noteAnchorChip({ kind: "region", ...region }, "image")).toBe("Area");
  });
});

describe("compare rows", () => {
  const rendition = { units: [{ index: 1, kind: "shot", start: 4, end: 9 }] } as never;
  it("labels shots with their time span and slides by number", () => {
    expect(compareUnitLabel("video", { baseIndex: 1, targetIndex: 1 }, rendition)).toBe(
      "Shot 2 · 0:04-0:09",
    );
    expect(compareUnitLabel("deck", { baseIndex: 3, targetIndex: null }, null)).toBe("Slide 4");
  });

  it("reads the changed region from either anchor shape", () => {
    const region = { x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(changeRegion({ anchor: { kind: "region", ...region } })).toEqual(region);
    expect(changeRegion({ anchor: { kind: "slide", index: 0, region } })).toEqual(region);
    expect(changeRegion({ anchor: { kind: "slide", index: 0 } })).toBeNull();
    expect(changeRegion({ anchor: null })).toBeNull();
  });

  it("finds the frame an anchor sits on", () => {
    const unit = (index: number, start?: number, end?: number) => ({
      index,
      kind: "shot" as const,
      ...(start === undefined ? {} : { start, end }),
      imageUrl: `/frame-${index}.png`,
      thumbUrl: null,
    });
    const film = { units: [unit(0, 0, 4), unit(1, 4, 9)], posterUrl: "/poster.png" };
    expect(anchorFrameUrl({ kind: "time", t: 4 }, film)).toBe("/frame-1.png");
    // Past the last shot there is no frame of that moment; the poster is a different one.
    expect(anchorFrameUrl({ kind: "time", t: 30 }, film)).toBeNull();
    expect(
      anchorFrameUrl({ kind: "slide", index: 1 }, { units: [unit(0), unit(1)], posterUrl: null }),
    ).toBe("/frame-1.png");
    const region = { kind: "region" as const, x: 0, y: 0, w: 0.5, h: 0.5 };
    expect(anchorFrameUrl(region, { units: [], posterUrl: "/poster.png" })).toBe("/poster.png");
    expect(anchorFrameUrl(null, film)).toBeNull();
  });
});

describe("renditionMeta and spendApprovalDetails", () => {
  it("summarizes a video by length and height, a deck by slide count", () => {
    expect(renditionMeta("video", { durationSeconds: 90, height: 1080, units: [] })).toBe(
      "1:30 · 1080p",
    );
    expect(
      renditionMeta("deck", { durationSeconds: null, height: null, units: [{}, {}] as never }),
    ).toBe("2 slides");
    expect(renditionMeta("image", { durationSeconds: null, height: 10, units: [] })).toBeNull();
  });

  it("lists service and model before the request's own settings", () => {
    expect(
      spendApprovalDetails({
        service: "Higgsfield",
        model: "seedance",
        settings: { seconds: "8" },
      }),
    ).toEqual([
      ["Service", "Higgsfield"],
      ["Model", "seedance"],
      ["seconds", "8"],
    ]);
  });
});
