import { execSync } from "node:child_process";
import { createConnection } from "node:net";
import type { AppAdapter } from "./AppAdapter.js";

function checkPort(port: number, timeout = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(timeout, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

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

  isStarting(): boolean {
    return false;
  }

  async isRunning(): Promise<boolean> {
    return checkPort(this.port);
  }

  logFile(): string | null {
    return null;
  }

  url(): string | null {
    return `http://localhost:${this.port}`;
  }

  lastError(): string | null {
    return null;
  }
}
