import type { AppAdapter } from "./AppAdapter.js";
export interface AppAdapterConfig {
    name: string;
    start: string;
    stop: string;
    kill: string;
    readyPattern?: string;
    port?: number;
}
export declare class ConfigAdapter implements AppAdapter {
    readonly name: string;
    private readonly config;
    private readonly cwd;
    constructor(config: AppAdapterConfig, cwd: string);
    logFile(): string;
    start(): Promise<void>;
    stop(): Promise<void>;
    kill(): Promise<void>;
    isRunning(): Promise<boolean>;
    private sendSignalToChildren;
}
//# sourceMappingURL=ConfigAdapter.d.ts.map