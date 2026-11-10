import { describe, expect, it } from "vite-plus/test";

import { codeProjects, codeThreads, workProjectKeys } from "./workScope.ts";

describe("work scope", () => {
  const projects = [
    { environmentId: "env-a", id: "repo", kind: "code" },
    { environmentId: "env-a", id: "deck", kind: "work" },
    { environmentId: "env-b", id: "deck" },
  ];
  const threads = [
    { id: "t1", environmentId: "env-a", projectId: "repo" },
    { id: "t2", environmentId: "env-a", projectId: "deck" },
    // The same project id on another environment is another project.
    { id: "t3", environmentId: "env-b", projectId: "deck" },
  ];

  it("keeps Work projects and their threads out of Code mode's lists", () => {
    expect(
      codeProjects(projects).map((project) => `${project.environmentId}/${project.id}`),
    ).toEqual(["env-a/repo", "env-b/deck"]);
    expect(codeThreads(threads, workProjectKeys(projects)).map((thread) => thread.id)).toEqual([
      "t1",
      "t3",
    ]);
  });

  it("hands back the same lists when there are no Work projects", () => {
    const code = projects.filter((project) => project.kind !== "work");
    expect(codeProjects(code)).toBe(code);
    expect(codeThreads(threads, workProjectKeys(code))).toBe(threads);
  });
});
