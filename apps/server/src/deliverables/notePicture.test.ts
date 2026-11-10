import { describe, expect, it } from "vite-plus/test";

import { notePictureFilter } from "./notePicture.ts";

describe("notePictureFilter", () => {
  it("is just the frame when the note marks no area", () => {
    expect(notePictureFilter(null)).toBe("[0:v]scale=1280:-2:flags=lanczos");
    // An area with no size has nothing to outline.
    expect(notePictureFilter({ x: 0.5, y: 0.5, w: 0, h: 0.2 })).toBe(
      "[0:v]scale=1280:-2:flags=lanczos",
    );
  });

  it("outlines the area on the frame and adds a close-up with room around it", () => {
    const graph = notePictureFilter({ x: 0.25, y: 0.5, w: 0.2, h: 0.1 });
    expect(graph).toContain("drawbox=x=iw*0.2500:y=ih*0.5000:w=iw*0.2000:h=ih*0.1000");
    expect(graph).toContain("crop=iw*0.2800:ih*0.1800:iw*0.2100:ih*0.4600");
    expect(graph.endsWith("[marked][closeup]vstack")).toBe(true);
  });

  it("keeps an area that runs past the frame inside it", () => {
    const graph = notePictureFilter({ x: 0.9, y: -0.1, w: 0.4, h: 0.3 });
    expect(graph).toContain("drawbox=x=iw*0.9000:y=ih*0.0000:w=iw*0.1000:h=ih*0.2000");
    expect(graph).toContain("crop=iw*0.1400:ih*0.2400:iw*0.8600:ih*0.0000");
  });
});
