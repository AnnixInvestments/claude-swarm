import { execSync, spawn } from "node:child_process";
import type { AppAdapter } from "./AppAdapter.js";

export interface AppAdapterConfig {
  name: string;
  start: string;
  stop: string;
  kill: string;
  readyPattern?: string;
}

export class ConfigAdapter implements AppAdapter {
  readonly name: string;
  private readonly config: AppAdapterConfig;
  private readonly cwd: string;

  constructor(config: AppAdapterConfig, cwd: string) {
    this.name = config.name;
    this.config = config;
    this.cwd = cwd;
  }

  async start(): Promise<void> {
    const proc = spawn(this.config.start, [], {
      cwd: this.cwd,
      stdio: "ignore",
      detached: true,
      shell: true,
    });
    proc.unref();

    if (!this.config.readyPattern) {
      return;
    }

    const pattern = new RegExp(this.config.readyPattern);
    const timeoutMs = 120000;
    const pollIntervalMs = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      if (await this.isRunning()) {
        return;
      }
      if (pattern) {
        return;
      }
    }

    throw new Error(`${this.name} did not start within ${timeoutMs}ms`);
  }

  async stop(): Promise<void> {
    if (this.config.stop.startsWith("signal:")) {
      const signal = this.config.stop.replace("signal:", "") as NodeJS.Signals;
      this.sendSignalToChildren(signal);
    } else {
      try {
        execSync(this.config.stop, { cwd: this.cwd, stdio: "pipe" });
      } catch {
        // stop command may exit non-zero
      }
    }
  }

  async kill(): Promise<void> {
    if (this.config.kill.startsWith("signal:")) {
      const signal = this.config.kill.replace("signal:", "") as NodeJS.Signals;
      this.sendSignalToChildren(signal);
    } else {
      try {
        execSync(this.config.kill, { cwd: this.cwd, stdio: "pipe" });
      } catch {
        // kill command may exit non-zero
      }
    }
  }

  async isRunning(): Promise<boolean> {
    try {
      const result = execSync(`pgrep -f "${this.config.start}" 2>/dev/null`, {
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
      return result !== "";
    } catch {
      return false;
    }
  }

  private sendSignalToChildren(signal: NodeJS.Signals): void {
    try {
      execSync(`pkill -${signal} -f "${this.config.start}" 2>/dev/null`, { stdio: "pipe" });
    } catch {
      // no matching processes
    }
  }
}
