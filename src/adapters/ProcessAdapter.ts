import { type ChildProcess, execSync, spawn } from "node:child_process";
import type { AppAdapter } from "./AppAdapter.js";

export interface ProcessAdapterConfig {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  readyPattern: RegExp;
  readyTimeoutMs?: number;
}

export class ProcessAdapter implements AppAdapter {
  readonly name: string;
  private process: ChildProcess | null = null;
  private readonly config: ProcessAdapterConfig;

  constructor(config: ProcessAdapterConfig) {
    this.name = config.name;
    this.config = config;
  }

  async start(): Promise<void> {
    if (await this.isRunning()) {
      return;
    }

    this.process = spawn(this.config.command, this.config.args, {
      cwd: this.config.cwd,
      stdio: "ignore",
      detached: true,
    });

    this.process.unref();

    this.process.on("exit", () => {
      this.process = null;
    });

    const timeoutMs = this.config.readyTimeoutMs ?? 120000;
    const pollIntervalMs = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      if (await this.isRunning()) {
        return;
      }
    }

    throw new Error(`${this.name} did not start within ${timeoutMs}ms`);
  }

  async stop(): Promise<void> {
    if (this.process?.pid) {
      process.kill(this.process.pid, "SIGTERM");
      this.process = null;
    }
  }

  async kill(): Promise<void> {
    if (this.process?.pid) {
      process.kill(this.process.pid, "SIGKILL");
      this.process = null;
    }
  }

  async isRunning(): Promise<boolean> {
    if (this.process !== null) {
      return true;
    }

    if (process.platform === "win32") {
      try {
        const pattern = `${this.config.command} ${this.config.args.join(" ")}`;
        const result = execSync(
          `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${pattern}*' } | Select-Object -First 1 -ExpandProperty ProcessId"`,
          { encoding: "utf-8", stdio: "pipe" },
        ).trim();
        return result !== "" && !Number.isNaN(Number(result));
      } catch {
        return false;
      }
    }

    try {
      const result = execSync(
        `pgrep -f "${this.config.command} ${this.config.args.join(" ")}" 2>/dev/null`,
        { encoding: "utf-8", stdio: "pipe" },
      ).trim();
      return result !== "";
    } catch {
      return false;
    }
  }

  logFile(): string | null {
    return null;
  }
}
