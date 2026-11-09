import * as NodeServices from "@effect/platform-node/NodeServices";
import { BRAND } from "@t3tools/contracts/brand";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect.each(["t3code", "T3 Code (Alpha)", "t3code-v2"])(
  "never imports Windows credential keys from the official %s profile",
  (sourceName) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "brand-profile-" });
      const source = path.join(directory, sourceName);
      yield* fs.makeDirectory(source, { recursive: true });
      yield* fs.writeFileString(
        path.join(source, "Local State"),
        '{"os_crypt":{"encrypted_key":"official-key"}}',
      );
      const userDataPath = yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform: "win32",
      });
      assert.equal(userDataPath, path.join(directory, BRAND.desktop.userDataDirNames.production));
      assert.isFalse(yield* fs.exists(path.join(userDataPath, "Local State")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
