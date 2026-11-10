import { useAtomValue } from "@effect/atom-react";
import type { DirectPushStatus } from "@t3tools/contracts";
import { useState } from "react";

import { useAtomCommand } from "~/state/use-atom-command";
import { usePrimaryEnvironment } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { readLocalApi } from "~/localApi";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

function directPushSummary(status: DirectPushStatus): {
  readonly label: string;
  readonly dot: string;
  readonly detail: string;
} {
  const account = status.serviceAccount;
  if (account.status === "not-configured") {
    return {
      label: "Not configured",
      dot: "bg-muted-foreground/40",
      detail:
        "Send agent alerts from this computer straight to your phone through your own free Firebase project. Choose the folder or file with its service-account key.",
    };
  }
  if (account.status === "invalid") {
    return { label: "Key not usable", dot: "bg-destructive", detail: account.reason };
  }
  const phones = status.devices.length;
  const latest = status.devices
    .flatMap((device) => (device.lastDelivery ? [device.lastDelivery] : []))
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const phoneText =
    phones === 0
      ? "No phone registered yet: open the app on a phone paired with this computer."
      : `${phones} phone${phones === 1 ? "" : "s"} registered.`;
  const lastText = latest
    ? latest.ok
      ? ` Last delivery ${relativeTime(latest.at)}.`
      : ` Last delivery failed ${relativeTime(latest.at)}: ${latest.error ?? "unknown error"}`
    : "";
  return {
    label: latest && !latest.ok ? "Delivery failing" : "Configured",
    dot: latest && !latest.ok ? "bg-warning" : "bg-success",
    detail: `Firebase project ${account.projectId}. ${phoneText}${lastText}`,
  };
}

export function DirectPushSettingsRow() {
  const environment = usePrimaryEnvironment();
  const environmentId = environment?.environmentId ?? null;
  const supported = environment?.serverConfig?.environment.capabilities.directPush === true;
  const query = useEnvironmentQuery(
    supported && environmentId
      ? serverEnvironment.directPushStatus({ environmentId, input: {} })
      : null,
  );
  const canEdit = useAtomValue(
    serverEnvironment.setDirectPushServiceAccount.permissionAtom(environmentId),
  );
  const setServiceAccount = useAtomCommand(serverEnvironment.setDirectPushServiceAccount);
  const sendTest = useAtomCommand(serverEnvironment.sendDirectPushTest);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<"save" | "test" | null>(null);
  const pickFolder = window.desktopBridge ? readLocalApi()?.dialogs.pickFolder : undefined;

  if (!supported || environmentId === null) return null;
  const status = query.data;
  const summary = status ? directPushSummary(status) : null;
  const configured = status?.serviceAccount.status === "configured";

  const save = async (path: string | null) => {
    setPending("save");
    const result = await setServiceAccount({ environmentId, input: { path } });
    setPending(null);
    if (result._tag !== "Success") {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not save the key",
          description: "Could not save the service-account key.",
        }),
      );
      return;
    }
    setDraft("");
    query.refresh();
  };

  const test = async () => {
    setPending("test");
    const result = await sendTest({ environmentId, input: {} });
    setPending(null);
    // A failed call is already reported by the command itself.
    if (result._tag !== "Success") return;
    const { deliveries } = result.value;
    const failed = deliveries.filter((delivery) => !delivery.ok);
    toastManager.add(
      stackedThreadToast(
        deliveries.length === 0
          ? {
              type: "warning",
              title: "No phone registered",
              description: "Open the app on a phone paired with this computer, then try again.",
            }
          : failed.length === 0
            ? {
                type: "success",
                title: "Test notification sent",
                description: deliveries.map((delivery) => delivery.label).join(", "),
              }
            : {
                type: "error",
                title: "Test notification failed",
                description: failed
                  .map((delivery) => `${delivery.label}: ${delivery.error ?? "failed"}`)
                  .join("\n"),
              },
      ),
    );
    query.refresh();
  };

  return (
    <SettingsRow
      {...searchableSetting("direct-push")}
      title="Phone notifications (direct)"
      description={summary?.detail ?? "Checking…"}
      status={
        summary ? (
          <span className="inline-flex items-center gap-1.5">
            <span className={`size-1.5 rounded-full ${summary.dot}`} aria-hidden />
            {summary.label}
          </span>
        ) : null
      }
      control={
        configured ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending !== null || (status?.devices.length ?? 0) === 0}
              onClick={() => void test()}
            >
              Send test notification
            </Button>
            {canEdit ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending !== null}
                onClick={() => void save(null)}
              >
                Remove key
              </Button>
            ) : null}
          </div>
        ) : null
      }
    >
      {/* Under the row, so the path field never squeezes the description into a column. */}
      {!configured && canEdit ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {pickFolder ? (
            <Button
              size="sm"
              variant="outline"
              disabled={pending !== null}
              onClick={() =>
                void pickFolder().then((folder) => (folder ? save(folder) : undefined))
              }
            >
              Choose folder…
            </Button>
          ) : null}
          <div className="min-w-48 flex-1 sm:max-w-80">
            <Input
              size="sm"
              aria-label="Path to the service-account JSON"
              placeholder="Path to the service-account JSON"
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={pending !== null || draft.trim() === ""}
            onClick={() => void save(draft.trim())}
          >
            Save
          </Button>
        </div>
      ) : null}
    </SettingsRow>
  );
}
