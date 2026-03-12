import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
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

const CONFIG_FILE_NAME = ".claude-swarm/config.json";
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

export function loadProjectsConfigFrom(filePath: string): ProjectsConfig {
  if (!existsSync(filePath)) {
    return { projects: [] };
  }

  try {
    const content = readFileSync(filePath, "utf-8");
    const config = JSON.parse(content) as ProjectsConfig;
    config.projects = config.projects.map((p) => ({
      ...p,
      name: basename(p.name) || p.name,
    }));
    return config;
  } catch {
    return { projects: [] };
  }
}

export function loadProjectsConfig(): ProjectsConfig {
  return loadProjectsConfigFrom(PROJECTS_CONFIG_FILE);
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
