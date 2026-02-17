import { execSync } from "node:child_process";
import type { AppAdapter } from "./AppAdapter.js";

export abstract class DevServerAdapter implements AppAdapter {
  abstract readonly name: string;
  protected readonly cwd: string;
  protected readonly port: number;
  protected abstract readonly startArgs: string[];
  protected abstract readonly processPattern: string;

  constructor(cwd: string, port: number) {
    this.cwd = cwd;
    this.port = port;
  }

  async start(): Promise<void> {
    const { spawn } = await import("node:child_process");
    const [cmd, ...args] = this.startArgs;
    const proc = spawn(cmd, args, {
      cwd: this.cwd,
      stdio: "ignore",
      detached: true,
    });
    proc.unref();
  }

  async stop(): Promise<void> {
    try {
      execSync(`pkill -f "${this.processPattern}" 2>/dev/null`, { stdio: "pipe" });
    } catch {}
  }

  async kill(): Promise<void> {
    try {
      execSync(`pkill -9 -f "${this.processPattern}" 2>/dev/null`, { stdio: "pipe" });
    } catch {}
  }

  async isRunning(): Promise<boolean> {
    try {
      const result = execSync(`lsof -i :${this.port} -sTCP:LISTEN 2>/dev/null | grep -c LISTEN`, {
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
      return Number.parseInt(result, 10) > 0;
    } catch {
      return false;
    }
  }

  logFile(): string | null {
    return null;
  }
}
