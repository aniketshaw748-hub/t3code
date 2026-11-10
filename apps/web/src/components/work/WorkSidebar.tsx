import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { Link, useLocation } from "@tanstack/react-router";
import { LayoutGridIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AppModeSwitch } from "./AppModeSwitch";
import { useWorkProjects, useWorkProjectStatus } from "./useWorkData";
import { ShelfStatusDot } from "./workStatus";

/** The app sidebar in Work mode: the shelf and the Work projects, no code threads. */
export function WorkSidebar() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const projects = useWorkProjects();
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      <AppModeSwitch />
      <SidebarContent className="min-h-full">
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname === "/work" || pathname === "/work/"}
                render={<Link to="/work" />}
              >
                <LayoutGridIcon />
                <span>Shelf</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <CollapsibleSectionHeader
            expanded={projectsExpanded}
            onClick={() => setProjectsExpanded(!projectsExpanded)}
          >
            Projects
          </CollapsibleSectionHeader>
          {!projectsExpanded ? null : projects.length === 0 ? (
            <p className="px-2 text-xs text-sidebar-muted-foreground">Start one from the shelf.</p>
          ) : (
            <SidebarMenu>
              {projects.map((project) => (
                <WorkSidebarProject
                  key={`${project.environmentId}:${project.id}`}
                  project={project}
                  pathname={pathname}
                />
              ))}
            </SidebarMenu>
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}

function WorkSidebarProject(props: {
  readonly project: EnvironmentProject;
  readonly pathname: string;
}) {
  const { project } = props;
  const { status } = useWorkProjectStatus(project);
  const href = `/work/${project.environmentId}/${project.id}`;
  const statusText = status.version === null ? status.label : `${status.label} · ${status.version}`;
  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              isActive={props.pathname === href}
              render={
                <Link
                  to="/work/$environmentId/$projectId"
                  params={{ environmentId: project.environmentId, projectId: project.id }}
                />
              }
            >
              <ShelfStatusDot kind={status.kind} />
              <span className="min-w-0 flex-1 truncate">{project.title}</span>
              {status.version === null ? null : (
                <span aria-hidden className="shrink-0 font-mono text-3xs font-normal opacity-70">
                  {status.version}
                </span>
              )}
              <span className="sr-only">{statusText}</span>
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="right">{statusText}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
