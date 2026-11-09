import { assert, it } from "@effect/vitest";
import {
  type OrchestrationV2ServerCommand,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SpendApprovals from "./SpendApprovals.ts";

const threadId = ThreadId.make("thread-1");
const providerInstanceId = ProviderInstanceId.make("codex");

/** Thread management that applies spend records to one in-memory card, as the orchestrator does. */
const withService = <A, E>(
  body: (input: {
    readonly service: SpendApprovals.SpendApprovals["Service"];
    readonly dispatched: Array<OrchestrationV2ServerCommand>;
    readonly endRun: () => void;
    readonly cardId: () => TurnItemId | undefined;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    let runStatus = "running";
    let card: { id: TurnItemId; approvalStatus: string } | undefined;
    const layer = Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadRecords: () =>
        Effect.sync(
          () =>
            ({
              thread: { projectId: ProjectId.make("project-1") },
              runs: [
                {
                  id: "run-1",
                  ordinal: 1,
                  status: runStatus,
                  rootNodeId: "node-1",
                  providerInstanceId,
                },
              ],
              turnItems:
                card === undefined
                  ? []
                  : [
                      {
                        id: card.id,
                        type: "spend_approval",
                        runId: "run-1",
                        nodeId: "node-1",
                        description: "Render 4 shots with a video model",
                        estimate: { amount: 2.4, unit: "USD" },
                        approvalStatus: card.approvalStatus,
                      },
                    ],
            }) as never,
        ),
      dispatch: (command) =>
        Effect.sync(() => {
          dispatched.push(command);
          if (command.type !== "spend_approval.record") return {} as never;
          if (card === undefined) card = { id: command.turnItemId, approvalStatus: "pending" };
          else if (card.approvalStatus === "pending") card.approvalStatus = command.approvalStatus;
          return {} as never;
        }),
    });
    return yield* Effect.gen(function* () {
      const service = yield* SpendApprovals.SpendApprovals;
      return yield* body({
        service,
        dispatched,
        endRun: () => {
          runStatus = "completed";
        },
        cardId: () => card?.id,
      });
    }).pipe(Effect.provide(SpendApprovals.layer.pipe(Layer.provide(layer))));
  });

const request = {
  threadId,
  providerInstanceId,
  requestKey: "ns:req-1",
  description: "Render 4 shots with a video model",
  estimate: { amount: 2.4, unit: "USD" },
  model: "video-model",
} as const;

it.effect("waits on the card and returns the user's approval", () =>
  withService(({ service, dispatched, cardId }) =>
    Effect.gen(function* () {
      const waiting = yield* service.request(request).pipe(Effect.forkChild);
      yield* TestClock.adjust("1 second");
      yield* service.answer({ threadId, turnItemId: cardId()!, decision: "approve" });
      yield* TestClock.adjust("1 second");
      assert.equal(yield* Fiber.join(waiting), "approved");
      assert.deepEqual(
        dispatched.map(
          (command) => command.type === "spend_approval.record" && command.approvalStatus,
        ),
        ["pending", "approved"],
      );
      const again = yield* service
        .answer({ threadId, turnItemId: cardId()!, decision: "decline" })
        .pipe(Effect.flip);
      assert.equal(again.reason, "already_answered");
    }),
  ),
);

it.effect("closes the card when the run ends or the wait times out", () =>
  withService(({ service, dispatched, endRun }) =>
    Effect.gen(function* () {
      const timedOut = yield* service
        .request({ ...request, timeoutMs: 5_000 })
        .pipe(Effect.forkChild);
      yield* TestClock.adjust("6 seconds");
      assert.equal(yield* Fiber.join(timedOut), "timed_out");
      assert.include(dispatched.at(-1) as object, { approvalStatus: "cancelled" });

      endRun();
      const stopped = yield* service
        .request({ ...request, requestKey: "ns:req-2" })
        .pipe(Effect.flip);
      assert.equal(stopped.reason, "agent_stopped");
    }),
  ),
);
