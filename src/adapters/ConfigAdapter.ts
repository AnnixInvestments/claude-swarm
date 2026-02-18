import { execSync, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppAdapter } from "./AppAdapter.js";

export type PlatformCommand = string | { mac: string; windows: string };

export interface AppAdapterConfig {
  name: string;
  start: PlatformCommand;
  stop: PlatformCommand;
  kill: PlatformCommand;
  readyPattern?: string;
  port?: number;
}

function resolveCommand(cmd: PlatformCommand): string {
  if (typeof cmd === "string") return cmd;
  return process.platform === "win32" ? cmd.windows : cmd.mac;
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
    return join(this.cwd, ".claude-swarm", "logs", `${this.name}.log`);
  }

  async start(): Promise<void> {
    const logPath = this.logFile();
    mkdirSync(dirname(logPath), { recursive: true });
    const logFd = openSync(logPath, "a");
    const startCmd = resolveCommand(this.config.start);

    if (!this.config.readyPattern) {
      const proc = spawn(startCmd, [], {
        cwd: this.cwd,
        stdio: ["ignore", logFd, logFd],
        detached: true,
        shell: true,
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
      detached: true,
      shell: true,
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
    const stopCmd = resolveCommand(this.config.stop);
    if (stopCmd.startsWith("signal:")) {
      const signal = stopCmd.replace("signal:", "") as NodeJS.Signals;
      this.killGroup(signal);
    } else {
      try {
        execSync(stopCmd, { cwd: this.cwd, stdio: "pipe" });
      } catch {}
      this.killGroup("SIGTERM");
    }
  }

  async kill(): Promise<void> {
    const killCmd = resolveCommand(this.config.kill);
    if (killCmd.startsWith("signal:")) {
      const signal = killCmd.replace("signal:", "") as NodeJS.Signals;
      this.killGroup(signal);
    } else {
      try {
        execSync(killCmd, { cwd: this.cwd, stdio: "pipe" });
      } catch {}
      this.killGroup("SIGKILL");
    }
  }

  async isRunning(): Promise<boolean> {
    const startCmd = resolveCommand(this.config.start);
    if (process.platform === "win32") {
      try {
        const result = execSync(
          `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${startCmd}*' } | Select-Object -First 1 -ExpandProperty ProcessId"`,
          { encoding: "utf-8", stdio: "pipe" },
        ).trim();
        return result !== "" && !Number.isNaN(Number(result));
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
    try {
      const result = execSync(`pgrep -f "${startCmd}" 2>/dev/null`, {
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
      return result !== "";
    } catch {
      return false;
    }
  }

  private killGroup(signal: NodeJS.Signals): void {
    const startCmd = resolveCommand(this.config.start);
    if (process.platform === "win32") {
      if (this.pid !== undefined) {
        try {
          execSync(`taskkill /PID ${this.pid} /T /F`, { stdio: "pipe" });
        } catch {}
      } else {
        const forceFlag = signal === "SIGKILL" ? "-Force " : "";
        try {
          execSync(
            `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${startCmd}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId ${forceFlag}-ErrorAction SilentlyContinue }"`,
            { stdio: "pipe" },
          );
        } catch {}
      }
      this.pid = undefined;
      return;
    }
    if (this.pid !== undefined) {
      try {
        process.kill(-this.pid, signal);
      } catch {}
      this.pid = undefined;
    }
    try {
      execSync(`pkill -${signal} -f "${startCmd}" 2>/dev/null`, { stdio: "pipe" });
    } catch {}
  }
}
