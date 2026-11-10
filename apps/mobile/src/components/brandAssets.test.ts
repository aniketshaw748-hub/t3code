import * as NodeFS from "node:fs";

import { BRAND } from "@t3tools/contracts/brand";
import { expect, it } from "vite-plus/test";

it("loads the in-app brand mark from the brand's own icon folder", () => {
  const source = NodeFS.readFileSync(new URL("./brandAssets.ts", import.meta.url), "utf8");
  const required = [...source.matchAll(/require\("([^"]+)"\)/g)].map((match) => match[1]);
  expect(required).toHaveLength(3);
  // Metro needs literal paths, so the folder is spelled out there; it must stay the brand's.
  for (const path of required) {
    expect(path).toContain(`/${BRAND.assets.directory}/`);
    expect(NodeFS.existsSync(new URL(path!, new URL("./brandAssets.ts", import.meta.url)))).toBe(
      true,
    );
  }
});
