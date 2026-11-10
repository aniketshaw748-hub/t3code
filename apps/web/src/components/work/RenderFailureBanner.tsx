import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { DeliverableRendition, DeliverableVersion, EnvironmentId } from "@t3tools/contracts";
import { CircleAlertIcon, RotateCcwIcon } from "lucide-react";
import { useState } from "react";

import { workEnvironment } from "../../state/work";
import { useAtomCommand } from "../../state/use-atom-command";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

/** A version's render ended without a preview: why, in plain words, and a way to render again. */
export function RenderFailureBanner(props: {
  readonly environmentId: EnvironmentId;
  readonly version: DeliverableVersion;
  readonly rendition: DeliverableRendition;
  readonly canOperate: boolean;
}) {
  const retryRendition = useAtomCommand(workEnvironment.retryRendition, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const retry = async () => {
    setPending(true);
    const result = await retryRendition({
      environmentId: props.environmentId,
      input: { versionId: props.version.id },
    });
    setPending(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not render it again",
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };
  return (
    <Alert variant="warning" role="status" className="shrink-0">
      <CircleAlertIcon aria-hidden />
      <AlertTitle>V{props.version.ordinal} could not be rendered</AlertTitle>
      {props.rendition.detail ? (
        <AlertDescription>{props.rendition.detail}</AlertDescription>
      ) : null}
      {props.canOperate ? (
        <AlertAction>
          <Button size="xs" variant="outline" disabled={pending} onClick={() => void retry()}>
            <RotateCcwIcon />
            Render again
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
