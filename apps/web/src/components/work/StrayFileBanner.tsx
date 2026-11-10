import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { Deliverable, EnvironmentId } from "@t3tools/contracts";
import { CopyIcon } from "lucide-react";
import { useState } from "react";

import { workEnvironment } from "../../state/work";
import { useAtomCommand } from "../../state/use-atom-command";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
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
    <Alert variant="info" role="status" className="shrink-0">
      <CopyIcon aria-hidden />
      <AlertTitle>Saved as a new file</AlertTitle>
      <AlertDescription>
        <span>
          Use <span className="font-medium text-foreground">{props.stray.title}</span> as V
          {nextOrdinal} of{" "}
          <span className="font-medium text-foreground">{props.original.title}</span>?
        </span>
      </AlertDescription>
      {props.canOperate ? (
        <AlertAction>
          <Button size="xs" variant="ghost" disabled={pending} onClick={() => void run(false)}>
            Keep as its own file
          </Button>
          <Button
            size="xs"
            disabled={pending || props.turnRunning}
            title={props.turnRunning ? "Wait for the agent's turn to finish" : undefined}
            onClick={() => void run(true)}
          >
            Use as V{nextOrdinal}
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
