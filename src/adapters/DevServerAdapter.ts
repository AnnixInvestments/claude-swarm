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
    if (process.platform === "win32") {
      try {
        execSync(
          `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${this.processPattern}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }"`,
          { stdio: "pipe" },
        );
      } catch {}
      return;
    }
    try {
      execSync(`pkill -f "${this.processPattern}" 2>/dev/null`, { stdio: "pipe" });
    } catch {}
  }

  async kill(): Promise<void> {
    if (process.platform === "win32") {
      try {
        execSync(
          `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${this.processPattern}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
          { stdio: "pipe" },
        );
      } catch {}
      return;
    }
    try {
      execSync(`pkill -9 -f "${this.processPattern}" 2>/dev/null`, { stdio: "pipe" });
    } catch {}
  }

  async isRunning(): Promise<boolean> {
    if (process.platform === "win32") {
      try {
        const result = execSync(
          `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${this.port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1"`,
          { encoding: "utf-8", stdio: "pipe" },
        ).trim();
        return result !== "";
      } catch {
        return false;
      }
    }
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
