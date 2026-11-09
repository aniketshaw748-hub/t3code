import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { Deliverable, EnvironmentId } from "@t3tools/contracts";
import { CopyIcon } from "lucide-react";
import { useState } from "react";

import { workEnvironment } from "../../state/work";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

/**
 * The agent saved a revision as a new file instead of overwriting the deliverable. One click
 * makes it the deliverable's next version, so the version history stays in one place.
 */
export function StrayFileBanner(props: {
  readonly environmentId: EnvironmentId;
  readonly stray: Deliverable;
  readonly original: Deliverable;
  readonly canOperate: boolean;
  /** Adopting rewrites the workspace, so it waits for the agent's turn to end. */
  readonly turnRunning: boolean;
}) {
  const resolve = useAtomCommand(workEnvironment.resolveStray, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const nextOrdinal = props.original.versionCount + 1;
  const run = async (adopt: boolean) => {
    setPending(true);
    const result = await resolve({
      environmentId: props.environmentId,
      input: { deliverableId: props.stray.id, adopt },
    });
    setPending(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: adopt ? "Could not use it as a version" : "Could not keep the file",
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };
  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-work-raised px-3 py-2 ring-1 ring-work-line"
    >
      <CopyIcon className="size-4 shrink-0 text-work-muted" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-work-ink">
        Saved as a new file. Use <span className="font-medium">{props.stray.title}</span> as V
        {nextOrdinal} of <span className="font-medium">{props.original.title}</span>?
      </p>
      {props.canOperate ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button size="xs" variant="ghost" disabled={pending} onClick={() => void run(false)}>
            Keep as its own file
          </Button>
          <Button
            size="xs"
            variant="contrast"
            disabled={pending || props.turnRunning}
            title={props.turnRunning ? "Wait for the agent's turn to finish" : undefined}
            onClick={() => void run(true)}
          >
            Use as V{nextOrdinal}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
