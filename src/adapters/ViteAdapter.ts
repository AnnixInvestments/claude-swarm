import { execSync } from "node:child_process";
import type { AppAdapter } from "./AppAdapter.js";

export class ViteAdapter implements AppAdapter {
  readonly name = "vite";
  private readonly cwd: string;
  private readonly port: number;

  constructor(cwd: string, port = 5173) {
    this.cwd = cwd;
    this.port = port;
  }

  async start(): Promise<void> {
    const { spawn } = await import("node:child_process");
    const proc = spawn("npx", ["vite"], {
      cwd: this.cwd,
      stdio: "ignore",
      detached: true,
    });
    proc.unref();
  }

  async stop(): Promise<void> {
    try {
      execSync(`pkill -f "vite" 2>/dev/null`, { stdio: "pipe" });
    } catch {
      // process may already be stopped
    }
  }

  async kill(): Promise<void> {
    try {
      execSync(`pkill -9 -f "vite" 2>/dev/null`, { stdio: "pipe" });
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
