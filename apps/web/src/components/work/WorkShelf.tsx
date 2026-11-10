import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { posterFor } from "@t3tools/client-runtime/work/shelf";
import { WORK_STARTERS, type WorkStarter } from "@t3tools/client-runtime/work/starters";
import type { DeliverableKind } from "@t3tools/contracts";
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
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { MediaStage, MediaStageRing } from "./MediaStage";
import { useStartWorkProject } from "./useWorkActions";
import { useWorkAssetUrl, useWorkProjects, useWorkProjectStatus } from "./useWorkData";
import { ShelfStatusLabel } from "./workStatus";

const KIND_ICON: Record<DeliverableKind, LucideIcon> = {
  deck: PresentationIcon,
  video: ClapperboardIcon,
  image: ImagesIcon,
  pdf: FileTextIcon,
  other: SparklesIcon,
};

/** Work mode's home: a card per project with its latest frame, its status in words and its version. */
export function WorkShelf() {
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
  const starters = WORK_STARTERS.map((starter) => {
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
  });
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <h1 className="text-sm font-medium">Work</h1>
          <span className="text-xs text-muted-foreground">
            {projects.length === 1 ? "1 project" : `${projects.length} projects`}
          </span>
        </WorkspacePageHeader>
        {projects.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PresentationIcon />
              </EmptyMedia>
              <EmptyTitle>No Work projects yet</EmptyTitle>
              <EmptyDescription>
                Start a deck, a video or an image set. The agent drafts it, and you review it here
                with notes pinned to the moment or slide.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <div className="flex flex-wrap justify-center gap-2">{starters}</div>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex w-full flex-col gap-6 pt-1 pb-12 pl-(--workspace-gutter-start) pr-(--workspace-gutter-end)">
              <section aria-label="Start a project" className="flex flex-wrap items-center gap-2">
                {starters}
              </section>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-4 gap-y-6">
                {projects.map((project) => (
                  <li key={`${project.environmentId}:${project.id}`}>
                    <WorkProjectCard project={project} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </SidebarInset>
  );
}

function WorkProjectCard({ project }: { readonly project: EnvironmentProject }) {
  const { snapshot, deliverable, status } = useWorkProjectStatus(project);
  const assetUrl = useWorkAssetUrl(project.environmentId);
  const poster =
    snapshot === null || deliverable === null
      ? null
      : assetUrl(posterFor(snapshot, deliverable.currentVersionId));
  const Icon = KIND_ICON[deliverable?.kind ?? "other"];
  return (
    <Link
      to="/work/$environmentId/$projectId"
      params={{ environmentId: project.environmentId, projectId: project.id }}
      className="group flex flex-col gap-2 rounded-lg outline-none"
    >
      <MediaStage className="flex aspect-video items-center justify-center border border-border">
        {poster === null ? (
          <Icon aria-hidden className="size-8 text-white/40" strokeWidth={1.5} />
        ) : (
          <img
            src={poster}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-opacity group-hover:opacity-90"
          />
        )}
        <MediaStageRing />
      </MediaStage>
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <span className="truncate text-sm font-medium text-foreground group-hover:underline group-hover:underline-offset-4">
          {project.title}
        </span>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <ShelfStatusLabel kind={status.kind} label={status.label} />
          {status.version === null ? null : (
            <>
              <span aria-hidden>·</span>
              <span className="shrink-0 font-mono">{status.version}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
