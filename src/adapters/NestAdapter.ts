import { execSync } from "node:child_process";
import type { AppAdapter } from "./AppAdapter.js";

export class NestAdapter implements AppAdapter {
  readonly name = "nest";
  private readonly cwd: string;
  private readonly port: number;

  constructor(cwd: string, port = 3000) {
    this.cwd = cwd;
    this.port = port;
  }

  async start(): Promise<void> {
    const { spawn } = await import("node:child_process");
    const proc = spawn("npx", ["nest", "start", "--watch"], {
      cwd: this.cwd,
      stdio: "ignore",
      detached: true,
    });
    proc.unref();
  }

  async stop(): Promise<void> {
    try {
      execSync(`pkill -f "nest.* start" 2>/dev/null`, { stdio: "pipe" });
    } catch {
      // process may already be stopped
    }
  }

  async kill(): Promise<void> {
    try {
      execSync(`pkill -9 -f "nest.* start" 2>/dev/null`, { stdio: "pipe" });
    } catch {
      // process may already be stopped
    }
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
}
