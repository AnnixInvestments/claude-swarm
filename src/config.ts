import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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
const USER_CONFIG_DIR = join(homedir(), ".config", "claude-swarm");
const PROJECTS_CONFIG_FILE = join(USER_CONFIG_DIR, "projects.json");

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

export function loadProjectsConfig(): ProjectsConfig {
  if (!existsSync(PROJECTS_CONFIG_FILE)) {
    return { projects: [] };
  }

  try {
    const content = readFileSync(PROJECTS_CONFIG_FILE, "utf-8");
    return JSON.parse(content) as ProjectsConfig;
  } catch {
    return { projects: [] };
  }
}

export function saveProjectsConfig(config: ProjectsConfig): void {
  try {
    mkdirSync(USER_CONFIG_DIR, { recursive: true });
    writeFileSync(PROJECTS_CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch {}
}

export function projectsConfigFile(): string {
  return PROJECTS_CONFIG_FILE;
}
