import { Link, useLocation } from "@tanstack/react-router";
import { LayoutGridIcon } from "lucide-react";

import { isElectron } from "../../env";
import { useThreadShells } from "../../state/entities";
import { SidebarChromeFooter, SidebarChromeHeader } from "../sidebar/SidebarChrome";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { isThreadBusy, useWorkProjects } from "./useWorkData";

/** The app sidebar in Work mode: the shelf and the Work projects, no code threads. */
export function WorkSidebar() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const projects = useWorkProjects();
  const busyProjects = new Set(
    useThreadShells()
      .filter((shell) => isThreadBusy(shell))
      .map((shell) => `${shell.environmentId}:${shell.projectId}`),
  );
  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
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
          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Projects</p>
          {projects.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">Start one from the shelf.</p>
          ) : (
            <SidebarMenu>
              {projects.map((project) => {
                const href = `/work/${project.environmentId}/${project.id}`;
                const busy = busyProjects.has(`${project.environmentId}:${project.id}`);
                return (
                  <SidebarMenuItem key={`${project.environmentId}:${project.id}`}>
                    <SidebarMenuButton
                      isActive={pathname === href}
                      render={
                        <Link
                          to="/work/$environmentId/$projectId"
                          params={{ environmentId: project.environmentId, projectId: project.id }}
                        />
                      }
                    >
                      <span
                        aria-hidden
                        className={
                          busy
                            ? "size-1.5 shrink-0 rounded-full bg-work-status-fixing"
                            : "size-1.5 shrink-0 rounded-full bg-work-line"
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">{project.title}</span>
                      {busy ? <span className="sr-only">Agent working</span> : null}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}
