import { describe, expect, it } from "vite-plus/test";

import {
  encodeBlobPointer,
  LARGE_FILE_BYTES,
  parseBlobPointer,
  storesAsPointer,
} from "./blobPointer.ts";

const oid = "a".repeat(64);

describe("blob pointers", () => {
  it("round-trips the Git LFS pointer format", () => {
    const text = encodeBlobPointer({ oid, size: 1234 });
    expect(text).toBe(`version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 1234\n`);
    expect(parseBlobPointer(text)).toEqual({ oid, size: 1234 });
  });

  it("rejects text that is not exactly a pointer", () => {
    expect(parseBlobPointer("hello\n")).toBeNull();
    expect(parseBlobPointer(`${encodeBlobPointer({ oid, size: 1 })}extra`)).toBeNull();
    expect(parseBlobPointer(encodeBlobPointer({ oid: "A".repeat(64), size: 1 }))).toBeNull();
  });

  it.each([
    ["out/final.mp4", 10, true],
    ["deck/Pitch.PPTX", 10, true],
    ["assets/logo.png", 10, true],
    ["audio/voice.wav", 10, true],
    ["src/slides.ts", 10, false],
    ["data/dump.json", LARGE_FILE_BYTES, true],
    ["Makefile", 10, false],
  ] as const)("%s (%d bytes) stores as pointer: %s", (path, size, expected) => {
    expect(storesAsPointer(path, size)).toBe(expected);
  });
});
