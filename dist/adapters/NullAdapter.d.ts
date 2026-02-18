import type { AppAdapter } from "./AppAdapter.js";
export declare class NullAdapter implements AppAdapter {
    readonly name = "null";
    start(): Promise<void>;
    stop(): Promise<void>;
    kill(): Promise<void>;
    isRunning(): Promise<boolean>;
    logFile(): string | null;
}
//# sourceMappingURL=NullAdapter.d.ts.map