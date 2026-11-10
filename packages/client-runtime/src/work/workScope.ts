/**
 * Work projects and Code projects live side by side in one environment, but each mode lists only
 * its own. These are the single test for which side a project or thread belongs to.
 */

interface ScopedProject {
  readonly environmentId: string;
  readonly id: string;
  readonly kind?: string | undefined;
}

interface ProjectThread {
  readonly environmentId: string;
  readonly projectId: string;
}

export const isWorkProject = (project: Pick<ScopedProject, "kind">): boolean =>
  project.kind === "work";

const projectKey = (environmentId: string, projectId: string) => `${environmentId}:${projectId}`;

/** Keys of the Work projects among `projects`, to pass to `codeThreads`. */
export function workProjectKeys(projects: ReadonlyArray<ScopedProject>): ReadonlySet<string> {
  return new Set(
    projects.filter(isWorkProject).map((project) => projectKey(project.environmentId, project.id)),
  );
}

const isWorkThread = (thread: ProjectThread, keys: ReadonlySet<string>): boolean =>
  keys.has(projectKey(thread.environmentId, thread.projectId));

/** The projects Code mode lists: everything but Work projects. */
export function codeProjects<P extends ScopedProject>(
  projects: ReadonlyArray<P>,
): ReadonlyArray<P> {
  return projects.some(isWorkProject)
    ? projects.filter((project) => !isWorkProject(project))
    : projects;
}

/** The threads Code mode lists: everything but the threads of Work projects. */
export function codeThreads<T extends ProjectThread>(
  threads: ReadonlyArray<T>,
  keys: ReadonlySet<string>,
): ReadonlyArray<T> {
  return keys.size === 0 ? threads : threads.filter((thread) => !isWorkThread(thread, keys));
}
