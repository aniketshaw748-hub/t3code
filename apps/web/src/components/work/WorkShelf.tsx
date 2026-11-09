import { primaryDeliverable, posterFor, shelfStatus } from "@t3tools/client-runtime/work/shelf";
import { WORK_STARTERS, type WorkStarter } from "@t3tools/client-runtime/work/starters";
import type { DeliverableKind } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Link } from "@tanstack/react-router";
import {
  ClapperboardIcon,
  FileTextIcon,
  ImagesIcon,
  PresentationIcon,
  SparklesIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { usePrimaryEnvironmentId } from "../../state/environments";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { useStartWorkProject } from "./useWorkActions";
import {
  isThreadBusy,
  useLatestAgentText,
  useWorkAssetUrl,
  useWorkProjects,
  useWorkProjectSnapshot,
  useWorkThreads,
} from "./useWorkData";
import { useWorkAppearance } from "./useWorkAppearance";
import { ShelfStatusChip } from "./WorkStatusChip";

const KIND_ICON: Record<DeliverableKind, LucideIcon> = {
  deck: PresentationIcon,
  video: ClapperboardIcon,
  image: ImagesIcon,
  pdf: FileTextIcon,
  other: SparklesIcon,
};

/** Work mode's home: a card per project with its latest frame and one plain status. */
export function WorkShelf() {
  useWorkAppearance();
  const projects = useWorkProjects();
  const environmentId = usePrimaryEnvironmentId();
  const start = useStartWorkProject();
  const [starting, setStarting] = useState<string | null>(null);
  const onStart = async (starter: WorkStarter) => {
    if (environmentId === null || starting !== null) return;
    setStarting(starter.id);
    await start(environmentId, starter);
    setStarting(null);
  };
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col bg-work-canvas text-work-ink">
        <WorkspacePageHeader electron={isElectron}>
          <h1 className="text-sm font-medium">Work</h1>
          <span className="text-xs text-work-muted">
            {projects.length === 1 ? "1 project" : `${projects.length} projects`}
          </span>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 pt-4 pb-12 sm:px-8">
            <section aria-label="Start a project" className="flex flex-wrap items-center gap-2">
              {WORK_STARTERS.map((starter) => {
                const Icon = KIND_ICON[starter.kind];
                return (
                  <Button
                    key={starter.id}
                    variant="outline"
                    size="sm"
                    disabled={environmentId === null || starting !== null}
                    onClick={() => void onStart(starter)}
                  >
                    <Icon />
                    {starting === starter.id ? "Starting…" : starter.label}
                  </Button>
                );
              })}
            </section>
            {projects.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-work-line px-6 py-16 text-center">
                <p className="text-sm font-medium">No Work projects yet</p>
                <p className="max-w-sm text-sm text-work-muted">
                  Start a deck, a video or an image set above. The agent drafts it, and you review
                  it here with notes pinned to the moment or slide.
                </p>
              </div>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-5">
                {projects.map((project) => (
                  <li key={`${project.environmentId}:${project.id}`}>
                    <WorkProjectCard project={project} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

function WorkProjectCard({ project }: { readonly project: EnvironmentProject }) {
  const snapshot = useWorkProjectSnapshot(project.environmentId, project.id);
  const threads = useWorkThreads(project.environmentId, project.id);
  const assetUrl = useWorkAssetUrl(project.environmentId);
  const running = threads.find((thread) => isThreadBusy(thread)) ?? null;
  // Only a running agent's words are read, so idle cards open no thread subscription.
  const agentText = useLatestAgentText(
    running === null ? null : scopeThreadRef(running.environmentId, running.id),
  );
  const status = shelfStatus({
    snapshot,
    threads: threads.map((thread) => thread.source),
    agentText,
  });
  const deliverable = snapshot === null ? null : primaryDeliverable(snapshot.deliverables);
  const poster =
    snapshot === null || deliverable === null
      ? null
      : assetUrl(posterFor(snapshot, deliverable.currentVersionId));
  const Icon = KIND_ICON[deliverable?.kind ?? "other"];
  return (
    <Link
      to="/work/$environmentId/$projectId"
      params={{ environmentId: project.environmentId, projectId: project.id }}
      className="group flex flex-col gap-2.5 rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-work-highlight"
    >
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-work-line bg-work-panel">
        {poster === null ? (
          <Icon aria-hidden className="size-8 text-work-muted" strokeWidth={1.5} />
        ) : (
          <img
            src={poster}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-opacity group-hover:opacity-90"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 px-0.5">
        <span className="truncate text-sm font-medium">{project.title}</span>
        <div className="flex min-w-0">
          <ShelfStatusChip kind={status.kind} label={status.label} />
        </div>
      </div>
    </Link>
  );
}
