import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadProjectsConfig, saveProjectsConfig } from "./config.js";

describe("loadProjectsConfig", () => {
  const testDir = join(tmpdir(), `claude-swarm-test-${Date.now()}`);
  const testFile = join(testDir, "projects.json");

  const writeTestConfig = (data: object) => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testFile, JSON.stringify(data), "utf-8");
  };

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it("should sanitize Windows full-path project names to basename", async () => {
    const { loadProjectsConfigFrom } = await import("./config.js");

    const corrupted = {
      projects: [
        {
          name: "C:\\Users\\andy\\Documents\\Annix-sync",
          path: "C:\\Users\\andy\\Documents\\Annix-sync",
        },
        { name: "C:\\dev\\claude-swarm", path: "C:\\dev\\claude-swarm" },
      ],
    };

    writeTestConfig(corrupted);
    const config = loadProjectsConfigFrom(testFile);

    expect(config.projects[0].name).toBe("Annix-sync");
    expect(config.projects[1].name).toBe("claude-swarm");
    expect(config.projects[0].path).toBe("C:\\Users\\andy\\Documents\\Annix-sync");
    expect(config.projects[1].path).toBe("C:\\dev\\claude-swarm");
  });

  it("should leave already-correct project names unchanged", async () => {
    const { loadProjectsConfigFrom } = await import("./config.js");

    const clean = {
      projects: [
        { name: "my-project", path: "C:\\dev\\my-project" },
        { name: "annix", path: "C:\\dev\\annix" },
      ],
    };

    writeTestConfig(clean);
    const config = loadProjectsConfigFrom(testFile);

    expect(config.projects[0].name).toBe("my-project");
    expect(config.projects[1].name).toBe("annix");
  });

  it("should handle forward-slash paths", async () => {
    const { loadProjectsConfigFrom } = await import("./config.js");

    const corrupted = {
      projects: [{ name: "/home/user/projects/my-app", path: "/home/user/projects/my-app" }],
    };

    writeTestConfig(corrupted);
    const config = loadProjectsConfigFrom(testFile);

    expect(config.projects[0].name).toBe("my-app");
  });

  it("should preserve worktreeDir when present", async () => {
    const { loadProjectsConfigFrom } = await import("./config.js");

    const data = {
      projects: [
        {
          name: "C:\\dev\\my-project",
          path: "C:\\dev\\my-project",
          worktreeDir: "C:\\dev\\my-project-worktrees",
        },
      ],
    };

    writeTestConfig(data);
    const config = loadProjectsConfigFrom(testFile);

    expect(config.projects[0].name).toBe("my-project");
    expect(config.projects[0].worktreeDir).toBe("C:\\dev\\my-project-worktrees");
  });

  it("should return empty projects for missing file", async () => {
    const { loadProjectsConfigFrom } = await import("./config.js");

    const config = loadProjectsConfigFrom(join(testDir, "nonexistent.json"));
    expect(config.projects).toEqual([]);
  });
});
