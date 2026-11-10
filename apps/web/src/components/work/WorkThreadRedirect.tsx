import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isWorkProject } from "@t3tools/client-runtime/work/scope";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Navigate } from "@tanstack/react-router";

import { useProject, useQuietThreadShell } from "../../state/entities";

/**
 * A Work project's thread reached by its thread address (a notification, the bubble, a pasted
 * link) opens on its project screen: Work threads have no place in Code mode.
 */
export function WorkThreadRedirect({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const shell = useQuietThreadShell(threadRef);
  const project = useProject(
    shell === null ? null : scopeProjectRef(threadRef.environmentId, shell.projectId),
  );
  if (project === null || !isWorkProject(project)) return null;
  return (
    <Navigate
      to="/work/$environmentId/$projectId"
      params={{ environmentId: project.environmentId, projectId: project.id }}
      replace
    />
  );
}
