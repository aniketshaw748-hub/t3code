import type { ThreadStructureTurnItem } from "@t3tools/client-runtime/state/models";
import { commandDisplayText } from "@t3tools/client-runtime/work-log/command-label";

import { plainLine } from "./bubbleText";

export interface ThreadProgressStep {
  readonly id: string;
  readonly label: string;
  readonly failed: boolean;
}

export interface ThreadProgressReport {
  /** The last few finished steps of the current turn, oldest first. */
  readonly steps: ReadonlyArray<ThreadProgressStep>;
  /** What is running right now, if anything. */
  readonly current: string | null;
  readonly plan: { readonly completed: number; readonly total: number } | null;
}

const LABEL_MAX = 72;
const ACTIVE_STATUSES = new Set(["pending", "running", "waiting"]);
const FAILED_STATUSES = new Set(["failed", "cancelled", "interrupted"]);

function short(text: string): string {
  return plainLine(text, { max: LABEL_MAX, pick: "first" }) ?? text.slice(0, LABEL_MAX);
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** One step in plain words, in the tense its status calls for; null for items that are not work. */
export function describeTurnItemStep(
  item: ThreadStructureTurnItem,
): { readonly label: string; readonly active: boolean } | null {
  const active = ACTIVE_STATUSES.has(item.status);
  const title = item.title?.trim() ? short(item.title) : null;
  switch (item.type) {
    case "command_execution": {
      const command = short(commandDisplayText(item.input));
      return { label: `${active ? "Running" : "Ran"} ${command}`, active };
    }
    case "file_change":
      return { label: `${active ? "Editing" : "Edited"} ${basename(item.fileName)}`, active };
    case "file_search":
      return {
        label: item.pattern
          ? `${active ? "Searching" : "Searched"} files for “${short(item.pattern)}”`
          : (title ?? (active ? "Searching files" : "Searched files")),
        active,
      };
    case "web_search": {
      const query = item.patterns?.find((pattern) => pattern.trim().length > 0);
      return {
        label: query
          ? `${active ? "Searching" : "Searched"} the web for “${short(query)}”`
          : active
            ? "Searching the web"
            : "Searched the web",
        active,
      };
    }
    case "dynamic_tool":
      return {
        label: title ?? `${active ? "Using" : "Used"} ${item.toolName ?? "a tool"}`,
        active,
      };
    case "subagent":
      return {
        label: `${active ? "Delegating" : "Delegated"}: ${title ?? short(item.prompt)}`,
        active,
      };
    case "todo_list":
      return { label: "Updated the plan", active: false };
    case "approval_request":
      return { label: "Asked for approval", active };
    case "user_input_request":
      return { label: "Asked you a question", active };
    case "reasoning":
      return active ? { label: "Thinking", active } : null;
    case "compaction":
      return { label: active ? "Compacting context" : "Compacted context", active };
    case "error":
      return { label: "Hit an error", active: false };
    default:
      return null;
  }
}

/** A short report of the current turn: what just happened, what runs now, and plan progress. */
export function deriveThreadProgressReport(
  items: ReadonlyArray<{ readonly item: ThreadStructureTurnItem }>,
  maxSteps = 3,
): ThreadProgressReport {
  const turnStart = items.findLastIndex(({ item }) => item.type === "user_message");
  const turn = items.slice(turnStart + 1).map(({ item }) => item);
  const steps: ThreadProgressStep[] = [];
  let current: string | null = null;
  for (const item of turn) {
    const step = describeTurnItemStep(item);
    if (step === null) continue;
    if (step.active) {
      current = step.label;
      continue;
    }
    steps.push({ id: item.id, label: step.label, failed: FAILED_STATUSES.has(item.status) });
  }
  const plan = items.findLast(({ item }) => item.type === "todo_list")?.item;
  return {
    steps: steps.slice(-maxSteps),
    current,
    plan:
      plan?.type === "todo_list" && plan.steps.length > 0
        ? {
            completed: plan.steps.filter((step) => step.status === "completed").length,
            total: plan.steps.length,
          }
        : null,
  };
}
