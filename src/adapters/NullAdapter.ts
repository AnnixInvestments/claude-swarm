import type { AppAdapter } from "./AppAdapter.js";

export class NullAdapter implements AppAdapter {
  readonly name = "null";

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  async kill(): Promise<void> {}

  async isRunning(): Promise<boolean> {
    return false;
  }

  isStarting(): boolean {
    return false;
  }

  logFile(): string | null {
    return null;
  }

  url(): string | null {
    return null;
  }

  lastError(): string | null {
    return null;
  }
}
