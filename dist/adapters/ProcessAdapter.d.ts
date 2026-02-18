import type { AppAdapter } from "./AppAdapter.js";
export interface ProcessAdapterConfig {
    name: string;
    command: string;
    args: string[];
    cwd: string;
    readyPattern: RegExp;
    readyTimeoutMs?: number;
}
export declare class ProcessAdapter implements AppAdapter {
    readonly name: string;
    private process;
    private readonly config;
    constructor(config: ProcessAdapterConfig);
    start(): Promise<void>;
    stop(): Promise<void>;
    kill(): Promise<void>;
    isRunning(): Promise<boolean>;
    logFile(): string | null;
}
//# sourceMappingURL=ProcessAdapter.d.ts.map