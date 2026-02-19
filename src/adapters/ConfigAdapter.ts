import { execSync, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppAdapter } from "./AppAdapter.js";

const isWindows = process.platform === "win32";

export type PlatformCommand = string | { mac: string; windows: string };

export interface AppAdapterConfig {
  name: string;
  start: PlatformCommand;
  stop?: PlatformCommand;
  kill?: PlatformCommand;
  readyPattern?: string;
  port?: number;
  health?: string;
}

function resolveCommand(cmd: PlatformCommand): string {
  if (typeof cmd === "string") return cmd;
  return process.platform === "win32" ? cmd.windows : cmd.mac;
}

function wrapForShell(cmd: string): string {
  if (process.platform === "win32" && cmd.trim().endsWith(".ps1")) {
    return `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& '${cmd}'"`;
  }
  return cmd;
}

export class ConfigAdapter implements AppAdapter {
  readonly name: string;
  private readonly config: AppAdapterConfig;
  private readonly cwd: string;
  private pid: number | undefined;

  constructor(config: AppAdapterConfig, cwd: string) {
    this.name = config.name;
    this.config = config;
    this.cwd = cwd;
  }

  logFile(): string {
    return join(this.cwd, "logs", `${this.name}.log`);
  }

  async start(): Promise<void> {
    await this.kill();
    const logPath = this.logFile();
    mkdirSync(dirname(logPath), { recursive: true });
    const logFd = openSync(logPath, "a");
    const startCmd = wrapForShell(resolveCommand(this.config.start));

    if (!this.config.readyPattern) {
      const proc = spawn(startCmd, [], {
        cwd: this.cwd,
        stdio: ["ignore", logFd, logFd],
        detached: !isWindows,
        shell: true,
        windowsHide: true,
      });
      this.pid = proc.pid;
      proc.unref();
      closeSync(logFd);
      return;
    }

    const pattern = new RegExp(this.config.readyPattern);
    const timeoutMs = 120000;

    let initialSize = 0;
    try {
      initialSize = statSync(logPath).size;
    } catch {}

    const proc = spawn(startCmd, [], {
      cwd: this.cwd,
      stdio: ["ignore", logFd, logFd],
      detached: !isWindows,
      shell: true,
      windowsHide: true,
    });
    this.pid = proc.pid;
    proc.unref();
    closeSync(logFd);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let offset = initialSize;
      let outputBuffer = "";
      const buf = Buffer.alloc(65536);

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(interval);
        if (err) reject(err);
        else resolve();
      };

      const checkLog = () => {
        try {
          const fd = openSync(logPath, "r");
          let bytesRead = readSync(fd, buf, 0, buf.length, offset);
          while (bytesRead > 0) {
            outputBuffer += buf.subarray(0, bytesRead).toString();
            offset += bytesRead;
            bytesRead = readSync(fd, buf, 0, buf.length, offset);
          }
          closeSync(fd);
          if (pattern.test(outputBuffer)) finish();
        } catch {}
      };

      const interval = setInterval(checkLog, 100);

      proc.on("exit", (code) => {
        if (!settled) {
          finish(new Error(`${this.name} exited before becoming ready (exit code: ${code})`));
        }
      });

      const timer = setTimeout(
        () => finish(new Error(`${this.name} did not become ready within ${timeoutMs / 1000}s`)),
        timeoutMs,
      );

      checkLog();
    });
  }

  async stop(): Promise<void> {
    const stopCfg = this.config.stop;
    if (stopCfg) {
      const stopCmd = resolveCommand(stopCfg);
      if (stopCmd.startsWith("signal:")) {
        const signal = stopCmd.replace("signal:", "") as NodeJS.Signals;
        this.killGroup(signal);
        return;
      }
      try {
        execSync(stopCmd, { cwd: this.cwd, stdio: "pipe" });
      } catch {}
    }
    this.killGroup("SIGTERM");
  }

  async kill(): Promise<void> {
    const killCfg = this.config.kill;
    if (killCfg) {
      const killCmd = resolveCommand(killCfg);
      if (killCmd.startsWith("signal:")) {
        const signal = killCmd.replace("signal:", "") as NodeJS.Signals;
        this.killGroup(signal);
        return;
      }
      try {
        execSync(killCmd, { cwd: this.cwd, stdio: "pipe" });
      } catch {}
    }
    this.killGroup("SIGKILL");
  }

  async isRunning(): Promise<boolean> {
    if (this.config.health) {
      try {
        const res = await fetch(this.config.health, { signal: AbortSignal.timeout(3000) });
        if (res.ok) return true;
        // Non-2xx but got a response — server is up, fall through to port/pid check
      } catch {
        // Connection refused / timeout — server is down
        return false;
      }
    }
    if (process.platform === "win32") {
      if (this.config.port) {
        try {
          const result = execSync(
            `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${this.config.port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1"`,
            { encoding: "utf-8", stdio: "pipe" },
          ).trim();
          return result !== "";
        } catch {
          return false;
        }
      }
      if (this.pid !== undefined) {
        try {
          const result = execSync(
            `powershell -NoProfile -Command "Get-Process -Id ${this.pid} -ErrorAction SilentlyContinue"`,
            { encoding: "utf-8", stdio: "pipe" },
          ).trim();
          return result !== "";
        } catch {
          return false;
        }
      }
      return false;
    }
    if (this.config.port) {
      try {
        const result = execSync(`lsof -i :${this.config.port} -t 2>/dev/null`, {
          encoding: "utf-8",
          stdio: "pipe",
        }).trim();
        return result !== "";
      } catch {
        return false;
      }
    }
    if (this.pid !== undefined) {
      try {
        process.kill(this.pid, 0);
        return true;
      } catch {
        this.pid = undefined;
      }
    }
    return false;
  }

  private killGroup(signal: NodeJS.Signals): void {
    if (process.platform === "win32") {
      if (this.pid !== undefined) {
        try {
          execSync(`taskkill /PID ${this.pid} /T /F`, { stdio: "pipe" });
        } catch {}
        this.pid = undefined;
        return;
      }
      if (this.config.port) {
        const forceFlag = signal === "SIGKILL" ? "-Force " : "";
        try {
          execSync(
            `powershell -NoProfile -Command "$conn = Get-NetTCPConnection -LocalPort ${this.config.port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { Stop-Process -Id $conn.OwningProcess ${forceFlag}-ErrorAction SilentlyContinue }"`,
            { stdio: "pipe" },
          );
        } catch {}
        return;
      }
      return;
    }
    if (this.pid !== undefined) {
      try {
        process.kill(-this.pid, signal);
      } catch {}
      this.pid = undefined;
      return;
    }
    if (this.config.port) {
      try {
        execSync(`lsof -ti :${this.config.port} | xargs kill -${signal} 2>/dev/null`, {
          stdio: "pipe",
        });
      } catch {}
    }
  }
}
