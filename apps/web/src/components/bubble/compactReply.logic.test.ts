import { describe, expect, it } from "vite-plus/test";

import { buildCompactReply } from "./compactReply.logic";
import { plainLine } from "./bubbleText";

describe("buildCompactReply", () => {
  it("lifts code blocks out of the prose", () => {
    const reply = buildCompactReply(
      ["Here is the fix:", "", "```ts", "const a = 1;", "const b = 2;", "```", "", "Done."].join(
        "\n",
      ),
      500,
    );
    expect(reply).toEqual({
      blocks: [
        { kind: "text", id: "block-0", markdown: "Here is the fix:" },
        {
          kind: "code",
          id: "block-1",
          language: "ts",
          code: "const a = 1;\nconst b = 2;",
          lineCount: 2,
        },
        { kind: "text", id: "block-2", markdown: "Done." },
      ],
      truncated: false,
    });
  });

  it("keeps a fence that is still streaming as code", () => {
    expect(buildCompactReply("Writing:\n~~~\nline one\n", 500).blocks).toEqual([
      { kind: "text", id: "block-0", markdown: "Writing:" },
      { kind: "code", id: "block-1", language: null, code: "line one", lineCount: 1 },
    ]);
  });

  it("stops long prose at a paragraph end and says so", () => {
    const first = "A".repeat(60);
    const reply = buildCompactReply(`${first}\n\n${"B".repeat(200)}\n\nC`, 100);
    expect(reply).toEqual({
      blocks: [{ kind: "text", id: "block-0", markdown: first }],
      truncated: true,
    });
  });
});

describe("plainLine", () => {
  it("drops markdown syntax and code, and shortens long lines", () => {
    expect(
      plainLine("## Summary\n- Fixed [the bug](https://example.com) in `a.ts`\n```\nx\n```", {
        max: 100,
        pick: "last",
      }),
    ).toBe("Fixed the bug in a.ts");
    expect(plainLine("word ".repeat(40), { max: 20, pick: "first" })).toBe("word word word word…");
    expect(plainLine("```\nonly code\n```", { max: 20, pick: "first" })).toBeNull();
  });
});
