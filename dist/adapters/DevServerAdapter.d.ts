import type { AppAdapter } from "./AppAdapter.js";
export declare abstract class DevServerAdapter implements AppAdapter {
    abstract readonly name: string;
    protected readonly cwd: string;
    protected readonly port: number;
    protected abstract readonly startArgs: string[];
    protected abstract readonly processPattern: string;
    constructor(cwd: string, port: number);
    start(): Promise<void>;
    stop(): Promise<void>;
    kill(): Promise<void>;
    isRunning(): Promise<boolean>;
    logFile(): string | null;
}
//# sourceMappingURL=DevServerAdapter.d.ts.map