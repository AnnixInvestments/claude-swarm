import { type ChildProcess, execSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  private proc: ChildProcess | null = null;
  private running = false;
  private started = false;
  private startError: string | null = null;

  constructor(config: AppAdapterConfig, cwd: string) {
    this.name = config.name;
    this.config = config;
    this.cwd = cwd;
  }

  logFile(): string {
    return join(this.cwd, "logs", `${this.name}.log`);
  }

  url(): string | null {
    if (this.config.health) {
      try {
        const u = new URL(this.config.health);
        return `${u.protocol}//${u.host}`;
      } catch {}
    }
    if (this.config.port) {
      return `http://localhost:${this.config.port}`;
    }
    return null;
  }

  lastError(): string | null {
    return this.startError;
  }

  async start(): Promise<void> {
    await this.kill();
    this.killPort();
    this.started = true;
    this.startError = null;

    const logPath = this.logFile();
    mkdirSync(dirname(logPath), { recursive: true });
    const logStream = createWriteStream(logPath, { flags: "w" });
    const startCmd = wrapForShell(resolveCommand(this.config.start));

    const proc = spawn(startCmd, [], {
      cwd: this.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: !isWindows,
      shell: true,
      windowsHide: true,
    });
    this.pid = proc.pid;
    this.proc = proc;

    if (!this.config.readyPattern) {
      proc.stdout?.pipe(logStream);
      proc.stderr?.pipe(logStream);
      this.running = true;
      this.registerInSwarm();

      proc.on("exit", () => {
        this.running = false;
        this.proc = null;
        this.deregisterFromSwarm();
      });
      return;
    }

    const pattern = new RegExp(this.config.readyPattern);
    const stripAnsi = (str: string) =>
      str.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g"), "");
    let outputBuffer = "";

    const onData = (chunk: Buffer) => {
      logStream.write(chunk);
      if (this.running) return;

      outputBuffer += chunk.toString();
      if (pattern.test(stripAnsi(outputBuffer))) {
        this.running = true;
        outputBuffer = "";
        this.registerInSwarm();
      }
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);

    proc.on("exit", (code) => {
      if (!this.running) {
        this.startError = `${this.name} exited before becoming ready (exit code: ${code})`;
      }
      this.running = false;
      this.proc = null;
      this.deregisterFromSwarm();
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

  isStarting(): boolean {
    return this.proc !== null && !this.running;
  }

  async isRunning(): Promise<boolean> {
    if (this.running) return true;
    if (!this.started) return false;

    const detected = await this.detectRunning();
    if (detected) {
      this.running = true;
      this.registerInSwarm();
    }
    return detected;
  }

  private async detectRunning(): Promise<boolean> {
    if (this.config.health) {
      try {
        const res = await fetch(this.config.health, { signal: AbortSignal.timeout(3000) });
        if (res.ok) return true;
      } catch {
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

  private registryPath(): string {
    return join(this.cwd, ".claude-swarm", "registry.json");
  }

  private loadRegistry(): Record<string, unknown> {
    const regPath = this.registryPath();
    if (!existsSync(regPath)) return {};
    try {
      return JSON.parse(readFileSync(regPath, "utf-8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private saveRegistry(registry: Record<string, unknown>): void {
    const regPath = this.registryPath();
    mkdirSync(dirname(regPath), { recursive: true });
    writeFileSync(regPath, JSON.stringify(registry, null, 2), "utf-8");
  }

  private registerInSwarm(): void {
    try {
      const registry = this.loadRegistry();
      registry[this.name] = {
        status: "running",
        pid: this.pid ?? null,
        port: this.config.port ?? null,
        log: this.logFile(),
        project: this.cwd,
        health: this.config.health ?? (this.config.port ? `http://localhost:${this.config.port}` : null),
        startedAt: new Date().toISOString(),
        stoppedAt: null,
      };
      this.saveRegistry(registry);
    } catch {}
  }

  private deregisterFromSwarm(): void {
    try {
      const registry = this.loadRegistry();
      const entry = registry[this.name] as Record<string, unknown> | undefined;
      if (entry) {
        entry.status = "stopped";
        entry.stoppedAt = new Date().toISOString();
        entry.pid = null;
        this.saveRegistry(registry);
      }
    } catch {}
  }

  private killPort(): void {
    if (!this.config.port) return;
    try {
      if (process.platform === "win32") {
        execSync(
          `powershell -NoProfile -Command "$conn = Get-NetTCPConnection -LocalPort ${this.config.port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
          { stdio: "pipe" },
        );
      } else {
        execSync(`lsof -ti :${this.config.port} | xargs kill -9 2>/dev/null`, { stdio: "pipe" });
      }
    } catch {}
  }

  private killGroup(signal: NodeJS.Signals): void {
    this.running = false;
    this.proc = null;

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
