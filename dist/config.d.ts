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
export declare function loadSwarmConfig(projectPath: string): SwarmConfig;
export declare function loadProjectsConfig(): ProjectsConfig;
export declare function saveProjectsConfig(config: ProjectsConfig): void;
export declare function projectsConfigFile(): string;
//# sourceMappingURL=config.d.ts.map