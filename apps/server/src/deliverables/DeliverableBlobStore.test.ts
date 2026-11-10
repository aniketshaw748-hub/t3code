import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as DeliverableBlobStore from "./DeliverableBlobStore.ts";

const layer = DeliverableBlobStore.layer.pipe(
  Layer.provide(
    ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "deliverable-store-" }),
  ),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCryptoLayer.layer)),
);

it.layer(layer)("DeliverableBlobStore", (it) => {
  it.effect("lets cleanup in only once every writer has left", () =>
    Effect.gen(function* () {
      const blobs = yield* DeliverableBlobStore.DeliverableBlobStore;
      const order: string[] = [];
      const writing = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const writer = yield* Effect.forkChild(
        blobs.whileWriting(
          Effect.gen(function* () {
            order.push("write starts");
            yield* Deferred.succeed(writing, undefined);
            yield* Deferred.await(finish);
            order.push("write ends");
          }),
        ),
      );
      yield* Deferred.await(writing);
      const cleaner = yield* Effect.forkChild(
        blobs.whileCleaning(Effect.sync(() => order.push("cleanup"))),
      );
      // The cleanup runs as far as it can here; with no lock it would be done.
      yield* Effect.yieldNow;
      yield* Deferred.succeed(finish, undefined);
      yield* Fiber.join(writer);
      yield* Fiber.join(cleaner);
      assert.deepEqual(order, ["write starts", "write ends", "cleanup"]);
    }),
  );
});
