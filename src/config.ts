import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppAdapterConfig } from "./adapters/index.js";

export interface ProjectConfig {
  name: string;
  path: string;
  worktreeDir?: string;
}

export interface ProjectsConfig {
  projects: ProjectConfig[];
  defaultProject?: string;
}

export interface SwarmConfig {
  branchPrefix?: string;
  apps?: AppAdapterConfig[];
}

const CONFIG_FILE_NAME = ".claude-swarm.json";
const PROJECTS_CONFIG_FILE_NAME = ".parallel-claude-projects.json";

export function loadSwarmConfig(projectPath: string): SwarmConfig {
  const configPath = join(projectPath, CONFIG_FILE_NAME);
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content) as SwarmConfig;
  } catch {
    return {};
  }
}

export function loadProjectsConfig(configFile: string): ProjectsConfig {
  if (!existsSync(configFile)) {
    return { projects: [] };
  }

  try {
    const content = readFileSync(configFile, "utf-8");
    return JSON.parse(content) as ProjectsConfig;
  } catch {
    return { projects: [] };
  }
}

export function saveProjectsConfig(configFile: string, config: ProjectsConfig): void {
  try {
    writeFileSync(configFile, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    // write failure is non-fatal
  }
}

export function projectsConfigFile(rootDir: string): string {
  return join(rootDir, PROJECTS_CONFIG_FILE_NAME);
}
