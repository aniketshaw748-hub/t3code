import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { BRAND } from "@t3tools/contracts/brand";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";

import { waitForProjectRemoval } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
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
import { Checkbox } from "../ui/checkbox";
import { toastManager } from "../ui/toast";

const describe = (error: unknown) => (error instanceof Error ? error.message : undefined);

/**
 * Deletes a Work project from Work mode. Removing the project and deleting its versions, notes
 * and stored media for good are two decisions: the second is asked for by itself and is off
 * unless ticked, and the files in the project's folder are left alone either way.
 */
export function DeleteWorkProject(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly canOperate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [withHistory, setWithHistory] = useState(false);
  const [pending, setPending] = useState(false);
  const deleteProject = useAtomCommand(projectEnvironment.delete, { reportFailure: false });
  const purgeHistory = useAtomCommand(workEnvironment.purgeHistory, { reportFailure: false });
  const navigate = useNavigate();

  const confirm = async () => {
    const { environmentId, projectId } = props;
    setPending(true);
    const removed = await deleteProject({ environmentId, input: { projectId, force: true } });
    if (removed._tag === "Failure") {
      setPending(false);
      if (!isAtomCommandInterrupted(removed)) {
        toastManager.add({
          type: "error",
          title: "Could not delete the project",
          description: describe(squashAtomCommandFailure(removed)),
        });
      }
      return;
    }
    await waitForProjectRemoval(scopeProjectRef(environmentId, projectId));
    if (withHistory) {
      const purged = await purgeHistory({ environmentId, input: { projectIds: [projectId] } });
      if (purged._tag === "Failure" && !isAtomCommandInterrupted(purged)) {
        toastManager.add({
          type: "error",
          title: "The project is deleted, but its versions and notes were kept",
          description: `${describe(squashAtomCommandFailure(purged)) ?? "They could not be deleted."} You can delete them in Settings → Maintenance.`,
        });
      }
    }
    setPending(false);
    setOpen(false);
    void navigate({ to: "/work" });
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Delete project"
        disabled={!props.canOperate}
        onClick={() => setOpen(true)}
      >
        <Trash2Icon />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{props.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The project and its chat leave {BRAND.displayName}. The files in the project's folder
              are never touched.
            </AlertDialogDescription>
            <label className="mt-2 flex cursor-pointer items-start gap-2 text-left text-sm">
              <Checkbox
                className="mt-0.5"
                checked={withHistory}
                onCheckedChange={(checked) => setWithHistory(checked === true)}
              />
              <span>
                Also delete its versions, notes and stored media
                <span className="block text-xs text-muted-foreground">
                  This cannot be undone. Left unticked, they are kept, and you can delete them later
                  in Settings → Maintenance.
                </span>
              </span>
            </label>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" disabled={pending} onClick={() => void confirm()}>
              {withHistory ? "Delete project and its history" : "Delete project"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
