import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { DeliverableRetainedHistory, EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";

import { formatBytes } from "../../lib/formatBytes";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { useAtomCommand } from "../../state/use-atom-command";
import { workEnvironment } from "../../state/work";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const retainedHistoryAtom = environmentAtomList("web-work-retained-history", (environmentId) =>
  workEnvironment.retainedHistory({ environmentId, input: {} }),
);
const purgePermissionsAtom = environmentAtomList(
  "web-work-purge-history-permissions",
  workEnvironment.purgeHistory.permissionAtom,
);

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * The versions, notes and stored media that removed Work projects still hold on each machine.
 * Removing a project never deletes them; this is where a person does, on confirmation.
 */
export function WorkHistoryStorage({
  environments,
}: {
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }>;
}) {
  const key = environmentIdsKey(environments.map((environment) => environment.environmentId));
  const histories = useAtomValue(retainedHistoryAtom(key));
  const permissions = useAtomValue(purgePermissionsAtom(key));
  const held = environments.flatMap((environment, index) => {
    const query = histories[index];
    return query?._tag === "Success" && query.value.projects.length > 0
      ? [{ ...environment, history: query.value, allowed: permissions[index] === true }]
      : [];
  });
  if (held.length === 0) return null;
  return (
    <SettingsSection id="storage-work-history" title="Work history of removed projects">
      {held.map((entry) => (
        <RetainedHistoryRow key={entry.environmentId} {...entry} />
      ))}
    </SettingsSection>
  );
}

function RetainedHistoryRow(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly history: DeliverableRetainedHistory;
  readonly allowed: boolean;
}) {
  const { environmentId, history } = props;
  const purgeHistory = useAtomCommand(workEnvironment.purgeHistory, { reportFailure: false });
  const refresh = useAtomRefresh(workEnvironment.retainedHistory({ environmentId, input: {} }));
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const versions = history.projects.reduce((sum, project) => sum + project.versionCount, 0);
  const notes = history.projects.reduce((sum, project) => sum + project.noteCount, 0);
  const names = history.projects.map((project) => project.title).join(", ");

  const purge = async () => {
    setConfirming(false);
    setPending(true);
    const result = await purgeHistory({
      environmentId,
      input: { projectIds: history.projects.map((project) => project.projectId) },
    });
    setPending(false);
    refresh();
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: `Deleted the Work history of ${plural(result.value.projects, "removed project")}`,
        description: "The space it held is freed in the background.",
      });
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: "Could not delete the Work history",
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  };

  return (
    <SettingsRow
      title={`${formatBytes(history.bytes)} on ${props.label}`}
      description={`${plural(history.projects.length, "removed project")} (${names}) still ${history.projects.length === 1 ? "keeps" : "keep"} ${plural(versions, "version")} and ${plural(notes, "note")}. Removing a project never deletes these.`}
      control={
        <>
          <Button
            variant="destructive-outline"
            size="xs"
            disabled={!props.allowed || pending}
            onClick={() => setConfirming(true)}
          >
            {pending ? "Deleting…" : "Delete history"}
          </Button>
          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this Work history for good?</AlertDialogTitle>
                <AlertDialogDescription>
                  The versions, notes and stored media of {names} on {props.label} are deleted and
                  cannot be brought back. The files in the projects' folders are not touched.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
                <Button variant="destructive" onClick={() => void purge()}>
                  Delete history
                </Button>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
        </>
      }
    />
  );
}
