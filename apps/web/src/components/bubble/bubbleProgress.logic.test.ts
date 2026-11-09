import type { ThreadStructureTurnItem } from "@t3tools/client-runtime/state/models";
import { MessageId, PlanId, ThreadId, TurnItemId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveThreadProgressReport, describeTurnItemStep } from "./bubbleProgress.logic";

const threadId = ThreadId.make("thread");
let ordinal = 0;

function item<T extends ThreadStructureTurnItem["type"]>(
  type: T,
  fields: Record<string, unknown>,
  status: ThreadStructureTurnItem["status"] = "completed",
): { readonly item: ThreadStructureTurnItem } {
  ordinal += 1;
  return {
    item: {
      id: TurnItemId.make(`item-${ordinal}`),
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal,
      status,
      title: null,
      startedAt: null,
      completedAt: null,
      type,
      ...fields,
    } as ThreadStructureTurnItem,
  };
}

const userMessage = (text: string) =>
  item("user_message", {
    messageId: MessageId.make(`message-${text}`),
    text,
    attachments: [],
    createdBy: "user",
    creationSource: "web",
  });

describe("describeTurnItemStep", () => {
  it("names commands without their shell wrapper and edits by file name", () => {
    expect(
      describeTurnItemStep(item("command_execution", { input: "bash -lc 'pnpm test'" }).item),
    ).toEqual({ label: "Ran pnpm test", active: false });
    expect(
      describeTurnItemStep(
        item("command_execution", {
          input:
            "\"C:\\\\Users\\\\me\\\\pwsh.exe\" -Command 'Start-Sleep -Seconds 1; Write-Output 17'",
        }).item,
      ),
    ).toEqual({ label: "Ran Start-Sleep -Seconds 1; Write-Output 17", active: false });
    expect(
      describeTurnItemStep(
        item("file_change", { fileName: "apps/web/src/index.css" }, "running").item,
      ),
    ).toEqual({ label: "Editing index.css", active: true });
  });

  it("skips items that are not work", () => {
    expect(
      describeTurnItemStep(
        item("assistant_message", { messageId: MessageId.make("reply"), streaming: false }).item,
      ),
    ).toBeNull();
    expect(describeTurnItemStep(item("reasoning", { streaming: false }).item)).toBeNull();
  });
});

describe("deriveThreadProgressReport", () => {
  it("reports the current turn's last steps, what runs now, and the plan", () => {
    const report = deriveThreadProgressReport(
      [
        userMessage("first"),
        item("command_execution", { input: "old command" }),
        userMessage("second"),
        item("todo_list", {
          planId: PlanId.make("plan"),
          steps: [
            { id: "1", text: "Read", status: "completed" },
            { id: "2", text: "Edit", status: "running" },
            { id: "3", text: "Test", status: "pending" },
          ],
        }),
        item("file_search", { pattern: "useBubble" }),
        item("file_change", { fileName: "src/a.ts" }),
        item("command_execution", { input: "pnpm lint", exitCode: 1 }, "failed"),
        item("command_execution", { input: "pnpm test" }, "running"),
      ],
      3,
    );
    expect(report.steps.map((step) => [step.label, step.failed])).toEqual([
      ["Searched files for “useBubble”", false],
      ["Edited a.ts", false],
      ["Ran pnpm lint", true],
    ]);
    expect(report.current).toBe("Running pnpm test");
    expect(report.plan).toEqual({ completed: 1, total: 3 });
  });

  it("is empty before any work", () => {
    expect(deriveThreadProgressReport([userMessage("hi")])).toEqual({
      steps: [],
      current: null,
      plan: null,
    });
  });
});
