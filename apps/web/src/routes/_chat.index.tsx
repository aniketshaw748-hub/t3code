import { createFileRoute, Navigate } from "@tanstack/react-router";

import { useClientSettings, useClientSettingsHydrated } from "../hooks/useSettings";
import { NoProjectsHero } from "../components/NoProjectsHero";
import { HostedEmptyState } from "../components/HostedEmptyState";
import { useEnvironments } from "../state/environments";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();
  const appMode = useClientSettings((settings) => settings.appMode);
  const hydrated = useClientSettingsHydrated();

  // The home page follows the mode the user last chose; wait to know it before opening a draft.
  if (!hydrated) return null;
  if (appMode === "work") return <Navigate to="/work" replace />;

  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedEmptyState />;
  }

  // With a project to start a thread in, the index shows the layout instead
  // (useIndexShowsLayout); before that it is the no-projects home.
  return <NoProjectsHero />;
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
