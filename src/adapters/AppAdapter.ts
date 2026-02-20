export interface AppAdapter {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  kill(): Promise<void>;
  isRunning(): Promise<boolean>;
  isStarting(): boolean;
  logFile(): string | null;
  url(): string | null;
  lastError(): string | null;
}
