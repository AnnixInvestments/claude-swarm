export interface AppAdapter {
    readonly name: string;
    start(): Promise<void>;
    stop(): Promise<void>;
    kill(): Promise<void>;
    isRunning(): Promise<boolean>;
    logFile(): string | null;
}
//# sourceMappingURL=AppAdapter.d.ts.map