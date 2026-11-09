import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { WorkProjectScreen } from "../components/work/WorkProjectScreen";

function WorkProjectRoute() {
  const { environmentId, projectId } = Route.useParams();
  return (
    <WorkProjectScreen
      key={`${environmentId}:${projectId}`}
      environmentId={environmentId as EnvironmentId}
      projectId={projectId as ProjectId}
    />
  );
}

export const Route = createFileRoute("/_chat/work/$environmentId/$projectId")({
  component: WorkProjectRoute,
});
