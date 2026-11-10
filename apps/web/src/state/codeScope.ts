import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { codeProjects, codeThreads, workProjectKeys } from "@t3tools/client-runtime/work/scope";

import { useProjects, useQuietThreadShells, useVisibleThreadShells } from "./entities";

/**
 * Code mode's lists. Work projects and their threads share the environment but belong to Work
 * mode, so the sidebar, command palette, project pickers and home page read from here. Point
 * reads and the complete lists are untouched; with no Work project these return the same lists.
 */

/** Every project but the Work ones. */
export function useCodeProjects(): ReadonlyArray<EnvironmentProject> {
  return codeProjects(useProjects());
}

/** `useQuietThreadShells` without the threads of Work projects, for lists that arrange threads. */
export function useCodeQuietThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  const workProjects = workProjectKeys(useProjects());
  return codeThreads(useQuietThreadShells(), workProjects);
}

/** `useVisibleThreadShells` without the threads of Work projects, for pickers and palettes. */
export function useCodeVisibleThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  const workProjects = workProjectKeys(useProjects());
  return codeThreads(useVisibleThreadShells(), workProjects);
}
