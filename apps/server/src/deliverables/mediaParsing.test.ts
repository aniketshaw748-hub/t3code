import { describe, expect, it } from "vite-plus/test";

import {
  parsePpm,
  parseProbe,
  parseSceneCuts,
  pptxSlideOrder,
  pptxSlideReferences,
  pptxSlideTitle,
  shotsFromCuts,
} from "./mediaParsing.ts";

describe("parseSceneCuts", () => {
  it("reads pts_time from showinfo lines only", () => {
    const stderr = [
      "[Parsed_showinfo_1 @ 0x1] n:   0 pts:  48000 pts_time:4.0     duration:512",
      "frame=  2 fps=0.0 q=-0.0 size=N/A time=00:00:02.00",
      "[Parsed_showinfo_1 @ 0x1] n:   1 pts:  24000 pts_time:2.04 duration:512",
    ].join("\n");
    expect(parseSceneCuts(stderr)).toEqual([2.04, 4]);
  });
});

describe("shotsFromCuts", () => {
  it("splits at cuts and drops cuts that would make slivers", () => {
    expect(shotsFromCuts([2, 2.1, 4, 5.9], 6)).toEqual([
      { index: 0, start: 0, end: 2 },
      { index: 1, start: 2, end: 4 },
      { index: 2, start: 4, end: 6 },
    ]);
    expect(shotsFromCuts([], 3)).toEqual([{ index: 0, start: 0, end: 3 }]);
  });
});

describe("parseProbe", () => {
  it("reads duration and the video stream size", () => {
    const json = JSON.stringify({
      streams: [{ codec_type: "audio" }, { codec_type: "video", width: 640, height: 360 }],
      format: { duration: "6.000000" },
    });
    expect(parseProbe(json)).toEqual({
      durationSeconds: 6,
      width: 640,
      height: 360,
      hasVideo: true,
    });
    expect(parseProbe("not json")).toBeNull();
  });
});

describe("pptx structure", () => {
  const presentation = `<p:presentation><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>`;
  const rels = `<Relationships><Relationship Id="rId2" Type="slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="slide" Target="slides/slide2.xml"/></Relationships>`;

  it("orders slides as the presentation lists them", () => {
    expect(pptxSlideOrder(presentation, rels)).toEqual([
      "ppt/slides/slide2.xml",
      "ppt/slides/slide1.xml",
    ]);
  });

  it("resolves a slide's internal references and skips external links", () => {
    const slideRels = `<Relationships><Relationship Id="rId2" Target="../media/image1.png"/><Relationship Id="rId1" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId9" Target="https://example.com" TargetMode="External"/></Relationships>`;
    expect(pptxSlideReferences("ppt/slides/slide1.xml", slideRels)).toEqual([
      "ppt/media/image1.png",
      "ppt/slideLayouts/slideLayout1.xml",
    ]);
  });

  it("takes the first non-empty text run as the title", () => {
    expect(pptxSlideTitle("<a:t> </a:t><a:t>Q3 &amp; beyond</a:t><a:t>body</a:t>")).toBe(
      "Q3 & beyond",
    );
    expect(pptxSlideTitle("<p:sld/>")).toBeUndefined();
  });
});

describe("parsePpm", () => {
  const ppm = (header: string, pixels: ReadonlyArray<number>) =>
    new Uint8Array([...new TextEncoder().encode(header), ...pixels]);

  it("reads a binary PPM's size and pixels, skipping comments", () => {
    const pixels = [255, 0, 0, 0, 255, 0];
    expect(parsePpm(ppm("P6\n2 1\n255\n", pixels))).toEqual({
      width: 2,
      height: 1,
      data: new Uint8Array(pixels),
    });
    expect(parsePpm(ppm("P6\n# made by a tool\n1 2\n255\n", pixels))).toMatchObject({
      width: 1,
      height: 2,
    });
  });

  it("refuses other formats and short files", () => {
    expect(parsePpm(ppm("P5\n2 1\n255\n", [1, 2]))).toBeNull();
    expect(parsePpm(ppm("P6\n2 1\n65535\n", [1, 2, 3, 4, 5, 6]))).toBeNull();
    expect(parsePpm(ppm("P6\n2 2\n255\n", [1, 2, 3]))).toBeNull();
    expect(parsePpm(new Uint8Array())).toBeNull();
  });
});
