#!/usr/bin/env node

import { type ChildProcess, execSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { checkbox, confirm, input, select } from "@inquirer/prompts";
import chalk from "chalk";
import type { AppAdapter } from "./adapters/index.js";
import { ConfigAdapter, NullAdapter } from "./adapters/index.js";
import { loadProjectsConfig, loadSwarmConfig, saveProjectsConfig } from "./config.js";
import type { ProjectConfig, ProjectsConfig } from "./config.js";
import { log } from "./log.js";

interface Branch {
  name: string;
  isLocal: boolean;
  isRemote: boolean;
  ahead: number;
  behind: number;
  lastCommit: string;
  lastCommitTime: string;
}

interface Session {
  pid: number;
  name: string;
  branch: string;
  project: string;
  status: "working" | "complete" | "error" | "idle";
  lastActivity: string;
  tty: string | null;
  isOrphaned: boolean;
}

interface ManagedSession {
  id: string;
  name: string;
  process: ChildProcess;
  branch: string;
  project: ProjectConfig;
  worktreePath?: string;
  startTime: Date;
  status: "running" | "stopped";
  headless: boolean;
  task?: string;
  pidFile?: string;
}

interface MenuChoice {
  name: string;
  value: string;
  key?: string;
}

interface SpawnOptions {
  branch?: string;
  createBranch?: boolean;
  headless?: boolean;
  task?: string;
}

enum Subcommand {
  Start = "start",
  Stop = "stop",
  Restart = "restart",
  Status = "status",
  Logs = "logs",
}

enum MainAction {
  Branches = "branches",
  Sessions = "sessions",
  Pull = "pull",
  Start = "start",
  Stop = "stop",
  Logs = "logs",
  Shortcut = "shortcut",
  Refresh = "refresh",
  Quit = "quit",
}

enum SessionAction {
  New = "new",
  PullChanges = "pull-changes",
  KillOrphaned = "kill-orphaned",
  KillSelect = "kill-select",
  Terminate = "terminate",
  Back = "back",
}

enum KillMethod {
  Graceful = "graceful",
  Force = "force",
  Cancel = "cancel",
}

enum BranchMenuAction {
  Create = "create",
  Back = "back",
}

enum BranchAction {
  Switch = "switch",
  Rebase = "rebase",
  Approve = "approve",
  Compare = "compare",
  Delete = "delete",
  Back = "back",
}

enum StartType {
  Main = "main",
  Issue = "issue",
  Branch = "branch",
  Cancel = "cancel",
}

enum BranchPlacement {
  Main = "main",
  Create = "create",
  Existing = "existing",
  Cancel = "cancel",
}

enum SessionMode {
  Interactive = "interactive",
  Headless = "headless",
  Cancel = "cancel",
}

enum PullChoice {
  CherryPickAll = "cherry-pick-all",
  CherryPickLatest = "cherry-pick-latest",
  Cancel = "cancel",
}

enum CherryPickAbort {
  Abort = "abort",
  Manual = "manual",
}

enum ProjectAction {
  AddNew = "add-new",
  Cancel = "cancel",
}

enum Sentinel {
  Cancel = "cancel",
  Back = "back",
  CreateNew = "create-new",
}

const DEFAULT_ROOT_DIR = process.cwd();
const DEFAULT_BRANCH_PREFIX = "claude/";

let currentProject: ProjectConfig = {
  name: basename(DEFAULT_ROOT_DIR) || "project",
  path: DEFAULT_ROOT_DIR,
};

let claudeBranchPrefix = DEFAULT_BRANCH_PREFIX;
let appAdapters: AppAdapter[] = [new NullAdapter()];
const managedSessions = new Map<string, ManagedSession>();
let sessionCounter = 0;

function rootDir(): string {
  return currentProject.path;
}

function worktreeDir(): string {
  return (
    currentProject.worktreeDir ??
    join(currentProject.path, "..", `${currentProject.name.toLowerCase()}-worktrees`)
  );
}

function initProject(project: ProjectConfig): void {
  currentProject = project;
  const swarmConfig = loadSwarmConfig(project.path);

  claudeBranchPrefix = swarmConfig.branchPrefix ?? DEFAULT_BRANCH_PREFIX;

  if (swarmConfig.apps && swarmConfig.apps.length > 0) {
    appAdapters = swarmConfig.apps.map((cfg) => new ConfigAdapter(cfg, project.path));
  } else {
    appAdapters = [new NullAdapter()];
  }
}

function localProjectsConfig(): ProjectsConfig {
  return loadProjectsConfig();
}

function persistProjectsConfig(config: ProjectsConfig): void {
  saveProjectsConfig(config);
}

function addProject(project: ProjectConfig): void {
  const config = localProjectsConfig();
  const existingIndex = config.projects.findIndex((p) => p.path === project.path);

  const updatedProjects =
    existingIndex >= 0
      ? config.projects.map((p, i) => (i === existingIndex ? project : p))
      : [...config.projects, project];

  persistProjectsConfig({ ...config, projects: updatedProjects });
}

function hasDesktopShortcut(project: ProjectConfig): boolean {
  if (process.platform !== "win32") return true;
  const nameLower = project.name.toLowerCase().replace(/[\s-_]/g, "");
  const desktopHasMatch = (dir: string): boolean => {
    if (!existsSync(dir)) return false;
    try {
      return readdirSync(dir).some((f) => {
        if (!f.toLowerCase().endsWith(".lnk")) return false;
        const stem = f
          .slice(0, -4)
          .toLowerCase()
          .replace(/[\s-_]/g, "");
        return stem === nameLower;
      });
    } catch {
      return false;
    }
  };
  return desktopHasMatch(join(homedir(), "Desktop")) || desktopHasMatch("C:\\Mac\\Home\\Desktop");
}

function createDesktopShortcut(project: ProjectConfig): boolean {
  if (process.platform !== "win32") return false;

  try {
    const nativeDesktop = join(homedir(), "Desktop");
    const parallelsDesktop = "C:\\Mac\\Home\\Desktop";
    const isParallels = existsSync(parallelsDesktop);

    if (!existsSync(nativeDesktop)) {
      mkdirSync(nativeDesktop, { recursive: true });
    }

    const swarmScript = join(project.path, "claude-swarm.ps1");
    if (!existsSync(swarmScript)) {
      log.warn(`No claude-swarm.ps1 found in ${project.path}`);
      return false;
    }

    const safeName = project.name.replace(/[^a-zA-Z0-9-_]/g, "");
    const wrapperPath = join(nativeDesktop, `${safeName}.ps1`);
    writeFileSync(
      wrapperPath,
      `$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")\r\n\r\nSet-Location "${project.path}"\r\n& ".\\claude-swarm.ps1"\r\n`,
      "utf-8",
    );

    const lnkName = `${project.name}.lnk`;
    const nativeLnk = join(nativeDesktop, lnkName);
    const psPath = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

    const createScript = join(tmpdir(), `claude-swarm-mkshortcut-${Date.now()}.ps1`);
    writeFileSync(
      createScript,
      `$WshShell = New-Object -ComObject WScript.Shell\r\n$s = $WshShell.CreateShortcut('${nativeLnk}')\r\n$s.TargetPath = '${psPath}'\r\n$s.Arguments = '-ExecutionPolicy Bypass -File ${wrapperPath}'\r\n$s.WorkingDirectory = '${project.path}'\r\n$s.IconLocation = '${psPath},0'\r\n$s.Description = 'Claude Swarm - ${project.name}'\r\n$s.Save()\r\n`,
      "utf-8",
    );
    execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${createScript}"`, {
      stdio: "pipe",
    });
    try {
      unlinkSync(createScript);
    } catch {}

    if (isParallels) {
      const macLnk = join(parallelsDesktop, lnkName);
      const data = readFileSync(nativeLnk);
      writeFileSync(macLnk, data);
    }

    return true;
  } catch (err) {
    log.error(`Failed to create shortcut: ${(err as Error).message}`);
    return false;
  }
}

async function selectProjectForSession(): Promise<ProjectConfig | null> {
  const config = localProjectsConfig();
  const cwdMatch = config.projects.find((p) => p.path === DEFAULT_ROOT_DIR);
  if (cwdMatch) return cwdMatch;

  const choices = [
    ...config.projects.map((p) => ({
      name: `${p.name} ${chalk.dim(`(${p.path})`)}`,
      value: p.path,
    })),
    { name: chalk.green("+ Add another project"), value: ProjectAction.AddNew },
    { name: chalk.dim("← Cancel"), value: ProjectAction.Cancel },
  ];

  const selected = await selectWithEscape(
    "Select project for this session:",
    choices,
    ProjectAction.Cancel,
  );

  if (selected === ProjectAction.Cancel) {
    return null;
  }

  if (selected === ProjectAction.AddNew) {
    const projectPath = await input({
      message: "Enter full path to project:",
      validate: (val) => {
        if (!val.trim()) return "Path required";
        if (!existsSync(val.trim())) return "Path does not exist";
        if (!existsSync(join(val.trim(), ".git"))) return "Not a git repository";
        return true;
      },
    });

    const trimmedPath = projectPath.trim();
    const defaultName = basename(trimmedPath) || "project";

    const projectName = await input({
      message: "Project name:",
      default: defaultName,
      validate: (val) => (val.trim() ? true : "Name required"),
    });

    const worktreeDirPath = await input({
      message: "Worktree directory (leave blank for default):",
      default: join(trimmedPath, "..", `${projectName.trim().toLowerCase()}-worktrees`),
    });

    const newProject: ProjectConfig = {
      name: projectName.trim(),
      path: trimmedPath,
      worktreeDir: worktreeDirPath.trim() || undefined,
    };

    addProject(newProject);
    log.info(`Added project: ${newProject.name}`);

    if (process.platform === "win32") {
      const createShortcut = await confirm({
        message: "Create a desktop shortcut for this project?",
        default: true,
      });
      if (createShortcut) {
        if (createDesktopShortcut(newProject)) {
          log.info(`Desktop shortcut created for ${newProject.name}`);
        }
      }
    }

    return newProject;
  }

  const project = config.projects.find((p) => p.path === selected);
  return project ?? null;
}

function exec(cmd: string, options: { cwd?: string; silent?: boolean } = {}): string {
  try {
    return execSync(cmd, {
      cwd: options.cwd ?? rootDir(),
      encoding: "utf-8",
      stdio: options.silent ? "pipe" : ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (!options.silent) {
      log.error(`Command failed: ${cmd}`);
      const stderr = (error as { stderr?: string })?.stderr?.toString().trim();
      if (stderr) {
        log.error(stderr);
      }
    }
    return "";
  }
}

function currentBranch(): string {
  return exec("git branch --show-current");
}

function claudeBranches(): Branch[] {
  const localOutput = exec(
    'git branch --format="%(refname:short)|%(committerdate:relative)|%(subject)"',
  );
  const localBranches = localOutput.split("\n").filter((line) => line.trim());

  return localBranches
    .filter((line) => line.startsWith(claudeBranchPrefix))
    .map((line) => {
      const [name, time, subject] = line.split("|");
      const aheadCount = exec(`git rev-list --count main..${name}`, { silent: true });
      const behindCount = exec(`git rev-list --count ${name}..main`, { silent: true });

      return {
        name,
        isLocal: true,
        isRemote: false,
        ahead: Number.parseInt(aheadCount, 10) || 0,
        behind: Number.parseInt(behindCount, 10) || 0,
        lastCommit: subject ?? "",
        lastCommitTime: time ?? "",
      };
    });
}

function allBranches(): string[] {
  const output = exec('git branch --format="%(refname:short)"');
  return output.split("\n").filter((line) => line.trim());
}

function formatBranchDisplay(branch: Branch, current: string): string {
  const isCurrent = branch.name === current;
  const marker = isCurrent ? chalk.green("●") : chalk.dim("○");
  const name = isCurrent ? chalk.green(branch.name) : branch.name;

  let status = "";
  if (branch.ahead > 0 && branch.behind > 0) {
    status = chalk.yellow(`↑${branch.ahead} ↓${branch.behind}`);
  } else if (branch.ahead > 0) {
    status = chalk.green(`↑${branch.ahead} ahead`);
  } else if (branch.behind > 0) {
    status = chalk.red(`↓${branch.behind} behind`);
  } else {
    status = chalk.dim("up to date");
  }

  const time = branch.lastCommitTime ? chalk.dim(`(${branch.lastCommitTime})`) : "";

  return `${marker} ${name} ${status} ${time}`;
}

function detectClaudeSessions(): Session[] {
  const seenPids = new Set<number>();
  const sessions: Session[] = [];

  try {
    const platform = process.platform;

    if (platform === "darwin" || platform === "linux") {
      const output = exec('ps -eo pid,tty,command | grep -E "[c]laude" | grep -v "claude-swarm"', {
        silent: true,
      });
      const lines = output.split("\n").filter((line) => line.trim());

      const result: Session[] = [];
      for (const line of lines) {
        const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
        if (!match) continue;

        const pid = Number.parseInt(match[1], 10);
        const tty = match[2];
        const command = match[3];

        if (seenPids.has(pid) || !command.includes("claude")) continue;
        seenPids.add(pid);

        const isOrphaned = tty === "??" || tty === "?";

        let branch = "unknown";
        let cwd = "";
        let project = "unknown";

        const lsofOutput = exec(`lsof -p ${pid} 2>/dev/null | grep cwd | head -1`, {
          silent: true,
        });
        const cwdMatch = lsofOutput.match(/\s(\/\S+)$/);
        if (cwdMatch) {
          cwd = cwdMatch[1];
          const branchOutput = exec(`git -C "${cwd}" branch --show-current 2>/dev/null`, {
            silent: true,
          });
          if (branchOutput) {
            branch = branchOutput;
          }
          const repoRoot = exec(`git -C "${cwd}" rev-parse --show-toplevel 2>/dev/null`, {
            silent: true,
          });
          if (repoRoot) {
            project = basename(repoRoot) || "unknown";
          }
        }

        result.push({
          pid,
          name: cwd ? basename(cwd) || "unknown" : `PID ${pid}`,
          branch,
          project,
          status: "working",
          lastActivity: "active",
          tty: isOrphaned ? null : tty,
          isOrphaned,
        });
      }
      return result;
    }
    if (platform === "win32") {
      const output = exec("tasklist /v /fo csv", { silent: true });
      const lines = output
        .split("\n")
        .filter((line) => line.toLowerCase().includes("claude") && !line.includes("claude-swarm"));

      const claudeProcesses: Array<{ processName: string; pid: number }> = [];
      for (const line of lines) {
        const match = line.match(/"([^"]+)","(\d+)"/);
        if (!match) continue;

        const processName = match[1];
        const pid = Number.parseInt(match[2], 10);
        if (Number.isNaN(pid) || seenPids.has(pid)) continue;
        if (!processName.toLowerCase().includes("claude")) continue;
        seenPids.add(pid);
        claudeProcesses.push({ processName, pid });
      }

      const pidsWithConsole = new Set<number>();
      if (claudeProcesses.length > 0) {
        const pidList = claudeProcesses.map((p) => p.pid).join(",");
        const psOutput = exec(
          `powershell -NoProfile -Command "${pidList} | ForEach-Object { $p = Get-Process -Id $_ -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { $_ } }"`,
          { silent: true },
        );
        for (const line of psOutput.split("\n")) {
          const pid = Number.parseInt(line.trim(), 10);
          if (!Number.isNaN(pid)) {
            pidsWithConsole.add(pid);
          }
        }
      }

      return claudeProcesses.map(({ pid }) => ({
        pid,
        name: `PID ${pid}`,
        branch: "unknown",
        project: "unknown",
        status: "working" as const,
        lastActivity: "active",
        tty: pidsWithConsole.has(pid) ? "console" : null,
        isOrphaned: !pidsWithConsole.has(pid),
      }));
    }
  } catch {
    return [];
  }

  return sessions;
}

function killExternalProcess(pid: number, force = false): boolean {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: "pipe" });
      } catch {
        execSync(
          `powershell -Command "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`,
          { stdio: "pipe" },
        );
      }
    } else {
      process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    }
    return true;
  } catch {
    return false;
  }
}

function killMultipleProcesses(
  pids: number[],
  force = false,
): { killed: number[]; failed: number[] } {
  const killed: number[] = [];
  const failed: number[] = [];

  for (const pid of pids) {
    if (killExternalProcess(pid, force)) {
      killed.push(pid);
    } else {
      failed.push(pid);
    }
  }

  return { killed, failed };
}

const terminalWidth = () => process.stdout.columns || 80;
const boxContentWidth = () => terminalWidth() - 2;

const BORDER_COLOR = "#0077cc";

const b = {
  top: (s: string) => chalk.bold.hex(BORDER_COLOR)(s),
  divider: (s: string) => chalk.bold.hex(BORDER_COLOR)(s),
  content: (s: string) => chalk.bold.hex(BORDER_COLOR)(s),
  footer: (s: string) => chalk.bold.hex(BORDER_COLOR)(s),
};

function printHeader(): void {
  process.stdout.write("\x1b[2J\x1b[H");
  const width = boxContentWidth();
  const titleText = "  ⬡  C L A U D E   S W A R M";
  const subtitle = `  ${currentProject.name} · parallel sessions · worktree isolation`;
  log.print(b.top(`┌${"─".repeat(width)}┐`));
  log.print(
    b.top("│") + b.top(titleText) + " ".repeat(Math.max(0, width - titleText.length)) + b.top("│"),
  );
  log.print(b.top("│") + chalk.dim(subtitle.padEnd(width)) + b.top("│"));
  log.print(b.divider(`├${"─".repeat(width)}┤`));
}

function printFooter(): void {
  log.print(b.footer(`└${"─".repeat(boxContentWidth())}┘`));
}

function printSection(title: string): void {
  const width = boxContentWidth();
  const text = `  ${title}`;
  log.print(b.content("│") + chalk.bold(text) + " ".repeat(width - text.length) + b.content("│"));
}

function printBoxLine(content: string, indent = 2): void {
  const stripAnsi = (str: string) =>
    str.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
  const cleanContent = stripAnsi(content);
  const width = boxContentWidth();
  const maxWidth = width - indent;

  if (cleanContent.length > maxWidth) {
    const truncated = `${cleanContent.slice(0, maxWidth - 1)}…`;
    log.print(b.content("│") + " ".repeat(indent) + truncated + b.content("│"));
  } else {
    const padding = maxWidth - cleanContent.length;
    log.print(b.content("│") + " ".repeat(indent) + content + " ".repeat(padding) + b.content("│"));
  }
}

function printEmptyLine(): void {
  log.print(b.content("│") + " ".repeat(boxContentWidth()) + b.content("│"));
}

async function switchToBranch(branch: string): Promise<void> {
  log.warn(`\nSwitching to ${branch}...`);
  const result = exec(`git checkout ${branch}`);
  if (result !== undefined) {
    log.info(`Switched to ${branch}`);
  }
}

async function rebaseBranch(branch: string): Promise<boolean> {
  log.warn(`\nRebasing ${branch} onto main...`);

  exec("git fetch origin");

  const current = currentBranch();
  if (current !== branch) {
    exec(`git checkout ${branch}`);
  }

  try {
    execSync("git rebase origin/main", { cwd: rootDir(), stdio: "inherit" });
    log.info(`Rebased ${branch} onto main`);
    return true;
  } catch {
    log.error("Rebase failed. Resolve conflicts and run: git rebase --continue");
    return false;
  }
}

async function mergeBranch(branch: string): Promise<boolean> {
  log.warn(`\nMerging ${branch} to main (fast-forward)...`);

  exec("git checkout main");
  exec("git fetch origin");

  try {
    execSync("git rebase origin/main", { cwd: rootDir(), stdio: "inherit" });
  } catch {
    log.error("Failed to sync main with origin. Resolve conflicts first.");
    return false;
  }

  try {
    execSync(`git merge --ff-only ${branch}`, { cwd: rootDir(), stdio: "inherit" });
    log.info(`Merged ${branch} to main`);
    return true;
  } catch {
    log.error("Fast-forward merge failed. Branch may need rebasing first.");
    return false;
  }
}

async function pullChanges(): Promise<void> {
  const branch = currentBranch();
  const headBefore = exec("git rev-parse HEAD", { silent: true });

  log.warn(`\nPulling changes for ${branch}...`);
  exec("git fetch origin");

  const hasChanges = exec("git status --porcelain", { silent: true }) !== "";
  let stashed = false;

  if (hasChanges) {
    log.info("Stashing local changes...");
    try {
      execSync('git stash push -m "claude-swarm auto-stash"', { cwd: rootDir(), stdio: "pipe" });
      stashed = true;
    } catch {
      log.error("Failed to stash changes");
      await confirm({ message: "Press Enter to continue...", default: true });
      return;
    }
  }

  try {
    execSync(`git pull --rebase origin ${branch}`, { cwd: rootDir(), stdio: "inherit" });
    log.info(`Pulled latest changes for ${branch}`);
  } catch (error) {
    const errorMsg = (error as { stderr?: Buffer })?.stderr?.toString() ?? "";
    log.error(`Pull failed${errorMsg ? `: ${errorMsg.trim()}` : ""}`);
    if (stashed) {
      log.info("Restoring stashed changes...");
      exec("git stash pop", { silent: true });
    }
    await confirm({ message: "Press Enter to continue...", default: true });
    return;
  }

  if (stashed) {
    log.info("Restoring stashed changes...");
    try {
      execSync("git stash pop", { cwd: rootDir(), stdio: "pipe" });
      log.info("Local changes restored");
    } catch {
      log.warn('Could not auto-restore stashed changes. Run "git stash pop" manually.');
      await confirm({ message: "Press Enter to continue...", default: true });
    }
  }

  const headAfter = exec("git rev-parse HEAD", { silent: true });
  if (headBefore === headAfter) {
    log.info("Already up to date.");
    return;
  }

  const changedFiles = exec(`git diff --name-only ${headBefore}..${headAfter}`, { silent: true });

  const depsChanged =
    changedFiles.includes("package.json") || changedFiles.includes("pnpm-lock.yaml");
  if (depsChanged) {
    log.warn("Dependencies changed. Running pnpm install...");
    try {
      execSync("pnpm install", { cwd: rootDir(), stdio: "inherit" });
      log.info("Dependencies installed");
    } catch {
      log.error("Failed to install dependencies");
    }
  }
}

async function deleteBranch(branch: string): Promise<void> {
  const worktreeList = exec("git worktree list --porcelain", { silent: true });
  const worktreeMatch = worktreeList.match(
    new RegExp(
      `worktree ([^\\n]+)\\n[^\\n]*\\nbranch refs/heads/${branch.replace("/", "\\/")}`,
      "m",
    ),
  );
  const worktreePath = worktreeMatch ? worktreeMatch[1] : null;

  if (worktreePath) {
    log.warn(`Branch ${branch} is linked to worktree at ${worktreePath}`);
    const removeWorktree = await confirm({
      message: "Remove worktree first?",
      default: true,
    });

    if (removeWorktree) {
      try {
        execSync(`git worktree remove "${worktreePath}" --force`, {
          cwd: rootDir(),
          stdio: "inherit",
        });
        log.info("Worktree removed");
      } catch {
        log.error(
          `Failed to remove worktree. Delete it manually: git worktree remove "${worktreePath}" --force`,
        );
        return;
      }
    } else {
      log.warn("Cannot delete branch while worktree exists.");
      return;
    }
  }

  const deleteLocal = await confirm({
    message: `Delete local branch ${branch}?`,
    default: true,
  });

  if (deleteLocal) {
    try {
      execSync(`git branch -D ${branch}`, { cwd: rootDir(), stdio: "inherit" });
      log.info(`Deleted local branch ${branch}`);
    } catch {
      log.error(`Failed to delete local branch ${branch}`);
      return;
    }
  }

  const hasRemote = exec(`git ls-remote --heads origin ${branch}`, { silent: true });
  if (hasRemote) {
    const deleteRemote = await confirm({
      message: `Delete remote branch ${branch}?`,
      default: true,
    });

    if (deleteRemote) {
      exec(`git push origin --delete ${branch}`);
      log.info(`Deleted remote branch ${branch}`);
    }
  }
}

async function startAdapters(quiet = false): Promise<void> {
  const hasRealAdapters = appAdapters.some((a) => !(a instanceof NullAdapter));
  if (!hasRealAdapters) {
    if (!quiet) {
      log.print(
        chalk.dim(
          "  No app adapters configured. Add a .claude-swarm.json to configure dev servers.",
        ),
      );
    }
    return;
  }

  await Promise.all(
    appAdapters.map(async (adapter) => {
      try {
        await adapter.start();
        if (!quiet) log.print(chalk.green(`  ${adapter.name} starting`));
      } catch (err) {
        log.print(chalk.red(`  Failed to start ${adapter.name}: ${(err as Error).message}`));
      }
    }),
  );
}

async function waitForStopped(adapter: AppAdapter, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await adapter.isRunning())) return;
    await new Promise<void>((r) => setTimeout(r, 200));
  }
}

async function stopAdapters(): Promise<void> {
  await Promise.all(
    appAdapters.map(async (adapter) => {
      log.print(`  Stopping ${adapter.name}...`);
      try {
        await adapter.stop();
        await waitForStopped(adapter);
        log.print(chalk.dim(`  ${adapter.name} stopped`));
      } catch {
        try {
          await adapter.kill();
          await waitForStopped(adapter);
          log.print(chalk.dim(`  ${adapter.name} killed`));
        } catch (err) {
          log.print(chalk.red(`  Failed to stop ${adapter.name}: ${(err as Error).message}`));
        }
      }
    }),
  );
}

async function isAnyAdapterRunning(): Promise<boolean> {
  const results = await Promise.all(appAdapters.map((a) => a.isRunning()));
  return results.some(Boolean);
}

async function showBranchMenu(): Promise<void> {
  const branches = claudeBranches();
  const current = currentBranch();

  if (branches.length === 0) {
    log.warn(`\nNo ${claudeBranchPrefix}* branches found.`);
    log.info("Claude branches are used for parallel development work.\n");

    const action = await selectWithEscape(
      "What would you like to do?",
      [
        { name: `Create a new ${claudeBranchPrefix}* branch`, value: BranchMenuAction.Create },
        { name: chalk.dim("← Back"), value: BranchMenuAction.Back },
      ],
      BranchMenuAction.Back,
    );

    if (action === BranchMenuAction.Create) {
      const branchName = await input({
        message: `Branch name (will be prefixed with ${claudeBranchPrefix}):`,
        validate: (val) => (val.trim() ? true : "Branch name required"),
      });

      const fullBranchName = `${claudeBranchPrefix}${branchName.trim()}`;
      exec(`git checkout -b ${fullBranchName}`);
      log.info(`Created and switched to ${fullBranchName}`);
    }
    return;
  }

  const choices = branches.map((branch) => ({
    name: formatBranchDisplay(branch, current),
    value: branch.name,
  }));

  choices.push(
    { name: `Create new ${claudeBranchPrefix}* branch`, value: BranchMenuAction.Create },
    { name: chalk.dim("← Back"), value: BranchMenuAction.Back },
  );

  const selected = await selectWithEscape("Select a branch:", choices, BranchMenuAction.Back);

  if (selected === BranchMenuAction.Back) return;

  if (selected === BranchMenuAction.Create) {
    const branchName = await input({
      message: `Branch name (will be prefixed with ${claudeBranchPrefix}):`,
      validate: (val) => (val.trim() ? true : "Branch name required"),
    });

    const fullBranchName = `${claudeBranchPrefix}${branchName.trim()}`;
    exec(`git checkout -b ${fullBranchName}`);
    log.info(`Created and switched to ${fullBranchName}`);
    return;
  }

  await branchActions(selected);
}

async function compareWithMain(branch: string): Promise<void> {
  log.info(`\nComparing ${branch} with main...`);

  const commitsAheadStr = exec(`git rev-list --count main..${branch}`, { silent: true });
  const ahead = Number.parseInt(commitsAheadStr, 10) || 0;

  if (ahead === 0) {
    log.info(`✓ ${branch} has no unique commits — it is already fully in main.`);

    const shouldDelete = await confirm({
      message: "Delete this branch since it's already in main?",
      default: true,
    });

    if (shouldDelete) {
      await deleteBranch(branch);
    }
  } else {
    log.warn(`${branch} has ${ahead} commit(s) not yet in main:\n`);

    const commits = exec(`git log --oneline main..${branch}`, { silent: true });
    if (commits) {
      log.print(commits);
    }

    const diffStat = exec(`git diff --stat main...${branch}`, { silent: true });
    if (diffStat) {
      log.print(`\n${diffStat}`);
    }

    await confirm({ message: "\nPress Enter to continue...", default: true });
  }
}

async function branchActions(branch: string): Promise<void> {
  const action = await selectWithEscape(
    `Actions for ${branch}:`,
    [
      { name: "Switch to this branch", value: BranchAction.Switch },
      { name: "Rebase onto main", value: BranchAction.Rebase },
      { name: "Approve (rebase + merge + delete)", value: BranchAction.Approve },
      { name: "Compare with main", value: BranchAction.Compare },
      { name: "Delete branch", value: BranchAction.Delete },
      { name: chalk.dim("← Back"), value: BranchAction.Back },
    ],
    BranchAction.Back,
  );

  if (action === BranchAction.Switch) {
    await switchToBranch(branch);
  } else if (action === BranchAction.Rebase) {
    await rebaseBranch(branch);
  } else if (action === BranchAction.Approve) {
    await approveBranch(branch);
  } else if (action === BranchAction.Compare) {
    await compareWithMain(branch);
  } else if (action === BranchAction.Delete) {
    await deleteBranch(branch);
  }
}

async function approveBranch(branch: string): Promise<void> {
  log.info(`\n=== Approving ${branch} ===\n`);

  const confirmed = await confirm({
    message: `This will:\n  1. Rebase ${branch} onto main\n  2. Fast-forward merge to main\n  3. Delete the branch\n\nContinue?`,
    default: false,
  });

  if (!confirmed) {
    log.warn("Cancelled.");
    return;
  }

  const rebased = await rebaseBranch(branch);
  if (!rebased) {
    log.error("Approval stopped due to rebase failure.");
    return;
  }

  const merged = await mergeBranch(branch);
  if (!merged) {
    log.error("Approval stopped due to merge failure.");
    return;
  }

  await deleteBranch(branch);

  log.info(`\nBranch ${branch} approved and merged to main!`);

  const push = await confirm({
    message: "Push main to origin?",
    default: true,
  });

  if (push) {
    log.warn("Pushing to origin...");
    execSync("git push origin main", { cwd: rootDir(), stdio: "inherit" });
    log.info("Pushed to origin.");
  }
}

async function spawnClaudeSession(options: SpawnOptions = {}): Promise<void> {
  const { branch, createBranch = false, headless = false, task } = options;

  sessionCounter++;
  const sessionId = `session-${sessionCounter}`;
  const modeLabel = headless ? "headless" : "interactive";
  const sessionName = `Claude ${sessionCounter} (${modeLabel})`;

  const branchName = branch ?? "main";
  const useWorktree = branch && branch !== "main";

  let worktreePath: string | undefined;
  let sessionDir = rootDir();

  if (useWorktree) {
    const worktreeName = branch.replace(claudeBranchPrefix, "").replace(/[^a-z0-9-]/gi, "-");
    worktreePath = join(worktreeDir(), worktreeName);
    sessionDir = worktreePath;

    if (!existsSync(worktreeDir())) {
      mkdirSync(worktreeDir(), { recursive: true });
    }

    const existingWorktrees = exec("git worktree list --porcelain", { silent: true });
    const worktreeExists = existingWorktrees.includes(worktreePath);

    if (!worktreeExists) {
      log.info(`Creating worktree at ${worktreePath}...`);
      if (createBranch) {
        exec(`git worktree add "${worktreePath}" -b ${branch}`, { silent: false });
      } else {
        exec(`git worktree add "${worktreePath}" ${branch}`, { silent: false });
      }

      if (!existsSync(worktreePath)) {
        log.error(`Failed to create worktree at ${worktreePath}`);
        return;
      }
    } else {
      log.info(`Using existing worktree at ${worktreePath}`);
    }
  }

  log.warn(`\nStarting new Claude Code session on ${branchName} (${modeLabel})...`);
  if (task) {
    log.info(`Task: ${task.slice(0, 60)}${task.length > 60 ? "..." : ""}`);
  }

  const isWindows = process.platform === "win32";

  let taskFile: string | null = null;
  if (task) {
    const tempDir = mkdtempSync(join(tmpdir(), "claude-task-"));
    taskFile = join(tempDir, "task.txt");
    writeFileSync(taskFile, task, "utf-8");
  }

  let claudeCmd = "claude";
  if (headless) {
    claudeCmd = taskFile
      ? `cat '${taskFile}' | claude -p --dangerously-skip-permissions`
      : "claude -p --dangerously-skip-permissions";
  } else if (taskFile) {
    claudeCmd = `cat '${taskFile}' | claude`;
  }

  let sessionProcess: ChildProcess;
  let pidFile: string | undefined;

  if (isWindows) {
    const claudePath = exec("where claude.cmd", { silent: true }).split("\n")[0].trim();
    const hasWindowsTerminal = exec("where wt", { silent: true }) !== "";

    let psClaudeCmd: string;
    if (headless) {
      psClaudeCmd = taskFile
        ? `Get-Content '${taskFile}' | & '${claudePath}' -p --dangerously-skip-permissions`
        : `& '${claudePath}' -p --dangerously-skip-permissions`;
    } else if (taskFile) {
      psClaudeCmd = `Get-Content '${taskFile}' | & '${claudePath}'`;
    } else {
      psClaudeCmd = `& '${claudePath}'`;
    }

    pidFile = join(tmpdir(), `claude-swarm-${sessionId}.pid`);
    const scriptFile = join(tmpdir(), `claude-swarm-${sessionId}.ps1`);
    writeFileSync(
      scriptFile,
      `$PID | Out-File -FilePath '${pidFile}' -NoNewline -Encoding ascii\r\n${psClaudeCmd}\r\n`,
      "utf-8",
    );

    if (hasWindowsTerminal) {
      const wtCmd = `wt -w -1 new-tab --title "${sessionName} on ${branchName}" --suppressApplicationTitle -d "${sessionDir}" powershell -ExecutionPolicy Bypass -NoProfile -File "${scriptFile}"`;
      sessionProcess = spawn(wtCmd, [], {
        cwd: rootDir(),
        detached: true,
        stdio: "ignore",
        shell: true,
      });
    } else {
      sessionProcess = spawn(
        "powershell",
        ["-ExecutionPolicy", "Bypass", "-NoProfile", "-File", scriptFile],
        {
          cwd: sessionDir,
          detached: true,
          stdio: "ignore",
        },
      );
    }
  } else {
    const terminalApp = process.env.TERM_PROGRAM === "iTerm.app" ? "iTerm" : "Terminal";
    const shellCmd = `cd "${sessionDir}" && ${claudeCmd}; claude --dangerously-skip-permissions`;
    const escapeForAppleScript = (cmd: string) => cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const escapedShellCmd = escapeForAppleScript(shellCmd);

    if (terminalApp === "iTerm") {
      try {
        execSync(
          `osascript <<EOF
tell application "iTerm"
  tell current window
    create tab with default profile
    tell current session
      write text "${escapedShellCmd}"
    end tell
  end tell
end tell
EOF`,
          { cwd: rootDir(), stdio: "inherit" },
        );
      } catch {
        try {
          execSync(
            `osascript <<EOF
tell application "iTerm"
  activate
  create window with default profile
  tell current session of current window
    write text "${escapedShellCmd}"
  end tell
end tell
EOF`,
            { cwd: rootDir(), stdio: "inherit" },
          );
        } catch {
          execSync(`osascript -e 'tell application "Terminal" to do script "${escapedShellCmd}"'`, {
            cwd: rootDir(),
            stdio: "inherit",
          });
        }
      }
    } else {
      execSync(
        `osascript -e 'tell application "Terminal" to do script "${escapedShellCmd}" in front window'`,
        { cwd: rootDir(), stdio: "inherit" },
      );
    }

    sessionProcess = spawn("echo", ["Session started in new terminal"], {
      cwd: rootDir(),
      detached: true,
      stdio: "ignore",
    });
  }

  sessionProcess.unref();

  const session: ManagedSession = {
    id: sessionId,
    name: sessionName,
    process: sessionProcess,
    branch: branchName,
    project: currentProject,
    worktreePath,
    startTime: new Date(),
    status: "running",
    headless,
    task,
    pidFile,
  };

  managedSessions.set(sessionId, session);

  log.info(`${sessionName} started on branch ${branchName}`);
  if (headless) {
    log.warn("  Headless mode: Claude will auto-accept all actions");
  }
}

async function terminateSession(sessionId: string): Promise<void> {
  const session = managedSessions.get(sessionId);
  if (!session) {
    log.error("Session not found.");
    return;
  }

  const confirmed = await confirm({
    message: `Terminate ${session.name} on branch ${session.branch}?`,
    default: false,
  });

  if (!confirmed) {
    log.warn("Cancelled.");
    return;
  }

  let killed = false;

  if (session.pidFile) {
    try {
      if (existsSync(session.pidFile)) {
        const realPid = Number.parseInt(readFileSync(session.pidFile, "utf-8").trim(), 10);
        if (!Number.isNaN(realPid)) {
          killed = killExternalProcess(realPid, true);
        }
      }
    } catch {}

    const scriptFile = session.pidFile.replace(/\.pid$/, ".ps1");
    for (const f of [session.pidFile, scriptFile]) {
      try {
        unlinkSync(f);
      } catch {}
    }
  }

  if (!killed && session.process.pid) {
    killed = killExternalProcess(session.process.pid, true);
  }

  session.status = "stopped";
  if (killed) {
    log.info(`${session.name} terminated.`);
  } else {
    log.warn(`Could not terminate ${session.name}. Close its terminal tab manually.`);
  }

  if (session.worktreePath) {
    const removeWorktree = await confirm({
      message: `Remove worktree at ${session.worktreePath}?`,
      default: true,
    });

    if (removeWorktree) {
      try {
        exec(`git worktree remove "${session.worktreePath}" --force`, { silent: false });
        log.info("Worktree removed.");
      } catch {
        log.warn(
          `Could not remove worktree. Remove manually with: git worktree remove "${session.worktreePath}"`,
        );
      }
    }
  }

  managedSessions.delete(sessionId);
}

async function pullChangesFromBranch(branch: string): Promise<void> {
  if (branch === "main") {
    log.warn("Cannot pull from main to main.");
    return;
  }

  const mainWorktreeBranch = exec("git branch --show-current", { cwd: rootDir(), silent: true });
  if (mainWorktreeBranch !== "main") {
    log.warn(`Main worktree is on ${mainWorktreeBranch}, not main. Cannot pull changes.`);
    return;
  }

  log.info(`\nChecking for commits on ${branch}...`);

  const commitsOutput = exec(`git log main..${branch} --oneline`, { silent: true });

  if (!commitsOutput) {
    log.warn("No new commits found on this branch yet.");
    log.info("Ask the Claude session to commit its changes first.");
    await confirm({ message: "Press Enter to continue...", default: true });
    return;
  }

  const commits = commitsOutput.split("\n").filter((line) => line.trim());
  log.print(`\n${chalk.bold(`Commits on ${branch}:`)}`);
  for (const commit of commits) {
    log.print(`  ${chalk.cyan(commit)}`);
  }
  log.print("");

  const pullChoice = await selectWithEscape(
    "What would you like to do?",
    [
      { name: "Cherry-pick all commits to main (for testing)", value: PullChoice.CherryPickAll },
      { name: "Cherry-pick latest commit only", value: PullChoice.CherryPickLatest },
      { name: chalk.dim("← Cancel"), value: PullChoice.Cancel },
    ],
    PullChoice.Cancel,
  );

  if (pullChoice === PullChoice.Cancel) return;

  const latestCommit = commits[0].split(" ")[0];
  const oldestCommit = commits[commits.length - 1].split(" ")[0];

  const cherryPickWithRetry = async (commitRange: string): Promise<boolean> => {
    try {
      execSync(`git cherry-pick -X theirs ${commitRange}`, { cwd: rootDir(), stdio: "inherit" });
      return true;
    } catch {
      log.error("Cherry-pick failed.");

      const abortChoice = await selectWithEscape(
        "What would you like to do?",
        [
          { name: "Abort and return to menu", value: CherryPickAbort.Abort },
          { name: "Leave as-is for manual resolution", value: CherryPickAbort.Manual },
        ],
        CherryPickAbort.Abort,
      );

      if (abortChoice === CherryPickAbort.Abort) {
        try {
          execSync("git cherry-pick --abort", { cwd: rootDir(), stdio: "pipe" });
          log.info("Cherry-pick aborted.");
        } catch {}
      } else {
        log.info('Resolve conflicts manually, then run "git cherry-pick --continue".');
      }
      return false;
    }
  };

  let success = false;
  if (pullChoice === PullChoice.CherryPickAll) {
    const commitRange = commits.length === 1 ? latestCommit : `${oldestCommit}^..${latestCommit}`;
    success = await cherryPickWithRetry(commitRange);
    if (success) {
      log.info(`Cherry-picked ${commits.length} commit(s) to main for testing.`);
    }
  } else {
    success = await cherryPickWithRetry(latestCommit);
    if (success) {
      log.info("Cherry-picked latest commit to main for testing.");
    }
  }

  if (success) {
    log.print("");
    log.info("Changes are now on main. Test them locally.");
    log.info("If they work: push when ready.");
    log.info('If they don\'t work: run "git reset --hard HEAD~1" to undo.');
  }

  await confirm({ message: "Press Enter to continue...", default: true });
}

async function showSessionsMenu(): Promise<void> {
  while (true) {
    const detectedSessions = detectClaudeSessions();
    const managed = Array.from(managedSessions.values());

    const attachedSessions = detectedSessions.filter((s) => !s.isOrphaned);
    const orphanedSessions = detectedSessions.filter((s) => s.isOrphaned);

    log.print(`\n${chalk.bold("=== Claude Sessions ===")}\n`);

    log.print(chalk.bold("Managed Sessions:"));
    if (managed.length === 0) {
      log.print(chalk.dim("  No sessions started from this manager."));
    } else {
      for (const session of managed) {
        const runtime = Math.round((Date.now() - session.startTime.getTime()) / 60000);
        const statusColor = session.status === "running" ? chalk.green : chalk.dim;
        const modeIcon = session.headless ? "headless" : "interactive";
        const projectLabel = chalk.bold(session.project.name);
        const taskPreview = session.task
          ? chalk.dim(` "${session.task.slice(0, 40)}${session.task.length > 40 ? "..." : ""}"`)
          : "";
        log.print(
          `  ${statusColor("●")} [${modeIcon}] ${projectLabel} ${chalk.cyan(session.branch)} [${runtime}m]${taskPreview}`,
        );
      }
    }

    log.print(`\n${chalk.bold("Active Sessions (attached to terminal):")}`);
    if (attachedSessions.length === 0) {
      log.print(chalk.dim("  No active sessions detected."));
    } else {
      for (const session of attachedSessions) {
        const projectDisplay =
          session.project !== "unknown"
            ? chalk.bold(session.project)
            : chalk.dim("unknown project");
        const branchDisplay =
          session.branch !== "unknown" ? chalk.cyan(session.branch) : chalk.dim("unknown branch");
        const ttyDisplay = session.tty ? chalk.dim(` [${session.tty}]`) : "";
        log.print(
          `  ${chalk.green("●")} ${projectDisplay} on ${branchDisplay} (PID ${session.pid})${ttyDisplay}`,
        );
      }
    }

    log.print(`\n${chalk.bold("Orphaned Sessions (detached from terminal):")}`);
    if (orphanedSessions.length === 0) {
      log.print(chalk.dim("  No orphaned sessions detected."));
    } else {
      for (const session of orphanedSessions) {
        const projectDisplay =
          session.project !== "unknown"
            ? chalk.bold(session.project)
            : chalk.dim("unknown project");
        const branchDisplay =
          session.branch !== "unknown" ? chalk.cyan(session.branch) : chalk.dim("unknown branch");
        log.print(
          `  ${chalk.red("●")} ${projectDisplay} on ${branchDisplay} (PID ${session.pid}) ${chalk.red("[orphaned]")}`,
        );
      }
    }

    log.print("");

    const existingBranches = claudeBranches();
    const branchesWithCommits = existingBranches.filter((b) => b.ahead > 0);

    const choices = [{ name: "Start new session", value: SessionAction.New }];

    if (branchesWithCommits.length > 0) {
      choices.push({ name: "Pull changes for testing", value: SessionAction.PullChanges });
    }

    if (orphanedSessions.length > 0) {
      choices.push({
        name: `Kill all orphaned sessions (${orphanedSessions.length})`,
        value: SessionAction.KillOrphaned,
      });
    }

    if (detectedSessions.length > 0) {
      choices.push({ name: "Select sessions to kill", value: SessionAction.KillSelect });
    }

    if (managed.length > 0) {
      choices.push({ name: "Terminate a managed session", value: SessionAction.Terminate });
    }

    choices.push({ name: chalk.dim("← Back"), value: SessionAction.Back });

    const action = await selectWithEscape("Session actions:", choices, SessionAction.Back);

    if (action === SessionAction.Back) return;

    if (action === SessionAction.KillOrphaned) {
      const killMethod = await selectWithEscape(
        "How to kill orphaned sessions?",
        [
          { name: "Graceful (SIGTERM) - allows cleanup", value: KillMethod.Graceful },
          { name: "Force (SIGKILL) - immediate termination", value: KillMethod.Force },
          { name: chalk.dim("← Cancel"), value: KillMethod.Cancel },
        ],
        KillMethod.Cancel,
      );

      if (killMethod === KillMethod.Cancel) continue;

      const confirmed = await confirm({
        message: `Kill ${orphanedSessions.length} orphaned session(s)? This cannot be undone.`,
        default: false,
      });

      if (confirmed) {
        const pids = orphanedSessions.map((s) => s.pid);
        const force = killMethod === KillMethod.Force;
        const result = killMultipleProcesses(pids, force);
        if (result.killed.length > 0) {
          log.info(`Killed ${result.killed.length} orphaned session(s).`);
        }
        if (result.failed.length > 0) {
          log.warn(
            `Failed to kill ${result.failed.length} session(s): PIDs ${result.failed.join(", ")}`,
          );
          if (!force) {
            log.info('Tip: Try "Force (SIGKILL)" if graceful termination fails.');
          }
        }
      }
      continue;
    }

    if (action === SessionAction.KillSelect) {
      const allSessions = [...attachedSessions, ...orphanedSessions];
      const sessionChoices = allSessions.map((s) => {
        const projectDisplay = s.project !== "unknown" ? s.project : "unknown project";
        const branchDisplay = s.branch !== "unknown" ? s.branch : "unknown branch";
        const statusLabel = s.isOrphaned ? chalk.red("[orphaned]") : chalk.green("[active]");
        return {
          name: `${projectDisplay} on ${branchDisplay} (PID ${s.pid}) ${statusLabel}`,
          value: s.pid,
          checked: s.isOrphaned,
        };
      });

      if (sessionChoices.length === 0) {
        log.warn("No sessions to kill.");
        continue;
      }

      const selectedPids = await checkbox({
        message: "Select sessions to kill (space to toggle, enter to confirm):",
        choices: sessionChoices,
        pageSize: 20,
      });

      if (selectedPids.length === 0) {
        log.warn("No sessions selected.");
        continue;
      }

      const killMethod = await selectWithEscape(
        "How to kill selected sessions?",
        [
          { name: "Graceful (SIGTERM) - allows cleanup", value: KillMethod.Graceful },
          { name: "Force (SIGKILL) - immediate termination", value: KillMethod.Force },
          { name: chalk.dim("← Cancel"), value: KillMethod.Cancel },
        ],
        KillMethod.Cancel,
      );

      if (killMethod === KillMethod.Cancel) continue;

      const confirmed = await confirm({
        message: `Kill ${selectedPids.length} selected session(s)? This cannot be undone.`,
        default: false,
      });

      if (confirmed) {
        const force = killMethod === KillMethod.Force;
        const result = killMultipleProcesses(selectedPids, force);
        if (result.killed.length > 0) {
          log.info(`Killed ${result.killed.length} session(s).`);
        }
        if (result.failed.length > 0) {
          log.warn(
            `Failed to kill ${result.failed.length} session(s): PIDs ${result.failed.join(", ")}`,
          );
          if (!force) {
            log.info('Tip: Try "Force (SIGKILL)" if graceful termination fails.');
          }
        }
      }
      continue;
    }

    if (action === SessionAction.PullChanges) {
      const branchChoices = branchesWithCommits.map((b) => ({
        name: `${b.name} (${b.ahead} commit${b.ahead > 1 ? "s" : ""} ahead)`,
        value: b.name,
      }));
      branchChoices.push({ name: chalk.dim("← Cancel"), value: Sentinel.Cancel });

      const selectedBranch = await selectWithEscape(
        "Pull changes from which branch?",
        branchChoices,
        Sentinel.Cancel,
      );

      if (selectedBranch !== Sentinel.Cancel) {
        await pullChangesFromBranch(selectedBranch);
      }
      continue;
    }

    if (action === SessionAction.New) {
      const selectedProject = await selectProjectForSession();
      if (!selectedProject) continue;

      initProject(selectedProject);
      log.info(`Working in: ${selectedProject.name}`);

      const startType = await selectWithEscape(
        "How would you like to start?",
        [
          { name: "Quick start on main (Recommended)", value: StartType.Main },
          { name: "Start with GitHub issue", value: StartType.Issue },
          { name: "Start on specific branch", value: StartType.Branch },
          { name: chalk.dim("← Cancel"), value: StartType.Cancel },
        ],
        StartType.Cancel,
      );

      if (startType === StartType.Cancel) continue;

      let selectedBranch: string | undefined;
      let task: string | undefined;
      let createNewBranch = false;

      if (startType === StartType.Issue) {
        log.info("\nFetching open GitHub issues...");
        const issuesJson = exec("gh issue list --state open --json number,title", {
          silent: true,
        });

        if (!issuesJson) {
          log.error("Could not fetch GitHub issues. Is gh CLI configured?");
          continue;
        }

        let issues: Array<{ number: number; title: string }> = [];
        try {
          issues = JSON.parse(issuesJson);
        } catch {
          log.error("Could not parse GitHub issues.");
          continue;
        }

        if (issues.length === 0) {
          log.warn("No open issues found.");
          continue;
        }

        const issueChoices = [
          ...issues.map((i) => ({ name: `#${i.number} ${i.title}`, value: String(i.number) })),
          { name: chalk.dim("← Cancel"), value: Sentinel.Cancel },
        ];

        const selectedIssue = await selectWithEscape(
          "Select an issue:",
          issueChoices,
          Sentinel.Cancel,
        );

        if (selectedIssue === Sentinel.Cancel) continue;

        const issueJson = exec(`gh issue view ${selectedIssue} --json title,body`, {
          silent: true,
        });
        if (issueJson) {
          try {
            const issue = JSON.parse(issueJson);
            task = `GitHub Issue #${selectedIssue}: ${issue.title}\n\n${issue.body}`;
            log.info(`Selected: ${issue.title}`);
          } catch {
            task = `Work on GitHub issue #${selectedIssue}`;
          }
        }

        const existingBranches = claudeBranches();
        const branchChoiceOptions = [
          { name: "Main directory (no isolation)", value: BranchPlacement.Main },
          {
            name: "New worktree (isolated directory with new branch)",
            value: BranchPlacement.Create,
          },
        ];

        if (existingBranches.length > 0) {
          branchChoiceOptions.push({
            name: "Existing worktree/branch",
            value: BranchPlacement.Existing,
          });
        }

        branchChoiceOptions.push({ name: chalk.dim("← Cancel"), value: BranchPlacement.Cancel });

        const branchChoice = await selectWithEscape(
          "Where should this session work?",
          branchChoiceOptions,
          BranchPlacement.Cancel,
        );

        if (branchChoice === BranchPlacement.Cancel) continue;

        if (branchChoice === BranchPlacement.Create) {
          const issueData = JSON.parse(issueJson ?? "{}");
          const suggestedName = (issueData.title ?? `issue-${selectedIssue}`)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 40);

          const branchName = await input({
            message: `Branch name (will be prefixed with ${claudeBranchPrefix}):`,
            default: suggestedName,
            validate: (val) => (val.trim() ? true : "Branch name required"),
          });

          selectedBranch = `${claudeBranchPrefix}${branchName.trim()}`;
          createNewBranch = true;
        } else if (branchChoice === BranchPlacement.Existing) {
          const existingBranchChoices = [
            ...existingBranches.map((b) => ({ name: b.name, value: b.name })),
            { name: chalk.dim("← Cancel"), value: Sentinel.Cancel },
          ];

          selectedBranch = await selectWithEscape(
            "Select existing branch:",
            existingBranchChoices,
            Sentinel.Cancel,
          );

          if (selectedBranch === Sentinel.Cancel) continue;
        } else {
          selectedBranch = "main";
        }
      } else if (startType === StartType.Branch) {
        const branches = claudeBranches();
        const allBranchesList = allBranches();

        const branchChoices = [
          { name: "Create new worktree with new branch", value: Sentinel.CreateNew },
          ...branches.map((b) => ({ name: `${b.name} (claude branch)`, value: b.name })),
          ...allBranchesList
            .filter((b) => !b.startsWith(claudeBranchPrefix) && b !== "main")
            .map((b) => ({ name: b, value: b })),
          { name: chalk.dim("← Cancel"), value: StartType.Cancel },
        ];

        selectedBranch = await selectWithEscape(
          "Select branch (will use/create worktree):",
          branchChoices,
          StartType.Cancel,
        );

        if (selectedBranch === StartType.Cancel) continue;

        if (selectedBranch === Sentinel.CreateNew) {
          const branchName = await input({
            message: `Branch name (will be prefixed with ${claudeBranchPrefix}):`,
            validate: (val) => (val.trim() ? true : "Branch name required"),
          });
          selectedBranch = `${claudeBranchPrefix}${branchName.trim()}`;
          createNewBranch = true;
        }

        const taskInput = await input({
          message: "Task description (optional, press Enter to skip):",
        });
        if (taskInput.trim()) {
          task = taskInput.trim();
        }
      } else {
        selectedBranch = "main";
      }

      const mode = await selectWithEscape(
        "Session mode:",
        [
          {
            name: "Interactive - prompts for confirmation (Recommended)",
            value: SessionMode.Interactive,
          },
          { name: "Headless - auto-accepts all actions", value: SessionMode.Headless },
          { name: chalk.dim("← Cancel"), value: SessionMode.Cancel },
        ],
        SessionMode.Cancel,
      );

      if (mode === SessionMode.Cancel) continue;

      const headless = mode === SessionMode.Headless;

      if (headless && !task) {
        task = await input({
          message: "Task for headless session:",
          validate: (val) => (val.trim() ? true : "Task required for headless mode"),
        });
      }

      await spawnClaudeSession({
        branch: selectedBranch,
        createBranch: createNewBranch,
        headless,
        task,
      });
    } else if (action === SessionAction.Terminate) {
      const sessionChoices = Array.from(managedSessions.values()).map((s) => ({
        name: `${s.name} on ${s.branch}`,
        value: s.id,
      }));
      sessionChoices.push({ name: chalk.dim("← Cancel"), value: SessionAction.Back });

      const selectedSession = await selectWithEscape(
        "Select session to terminate:",
        sessionChoices,
        SessionAction.Back,
      );

      if (selectedSession !== SessionAction.Back) {
        await terminateSession(selectedSession);
      }
    }
  }
}

async function showStatus(): Promise<void> {
  const branches = claudeBranches();
  const current = currentBranch();
  const managed = Array.from(managedSessions.values());

  printHeader();

  printSection("Current branch");
  printBoxLine(chalk.green(current));
  printEmptyLine();

  printSection(`Claude branches (${claudeBranchPrefix}*)`);
  if (branches.length === 0) {
    printBoxLine(chalk.dim(`No ${claudeBranchPrefix}* branches`));
  } else {
    for (const branch of branches) {
      const display = formatBranchDisplay(branch, current);
      printBoxLine(display);
    }
  }
  printEmptyLine();

  printSection("Sessions");
  if (managed.length === 0) {
    printBoxLine(chalk.dim("No managed sessions"));
  } else {
    for (const session of managed) {
      const runtime = Math.round((Date.now() - session.startTime.getTime()) / 60000);
      const statusIcon = session.status === "running" ? chalk.green("●") : chalk.dim("○");
      const issueMatch = session.task?.match(/GitHub Issue #(\d+)/);
      const issueLabel = issueMatch ? `${chalk.yellow(`#${issueMatch[1]}`)} ` : "";
      const worktreeIcon = session.worktreePath ? "W " : "";
      const line = `${statusIcon} ${worktreeIcon}${issueLabel}${session.name} on ${session.branch} [${runtime}m]`;
      printBoxLine(line);
    }
  }
  printEmptyLine();

  const hasRealAdapters = appAdapters.some((a) => !(a instanceof NullAdapter));

  if (hasRealAdapters) {
    printSection("Apps");
    for (const adapter of appAdapters) {
      if (!(adapter instanceof NullAdapter)) {
        const running = await adapter.isRunning();
        const adapterUrl = adapter.url();
        const error = adapter.lastError();
        const urlSuffix =
          running && adapterUrl
            ? chalk.cyan(` ${adapterUrl}`) + chalk.dim(" (Ctrl+Click to open)")
            : "";
        let statusText: string;
        if (error) {
          statusText = chalk.red(`${adapter.name}: failed`) + chalk.dim(` (${error})`);
        } else if (running) {
          statusText = chalk.green(`${adapter.name}: running`) + urlSuffix;
        } else if (adapter.isStarting()) {
          statusText = chalk.yellow(`${adapter.name}: starting...`);
        } else {
          statusText = chalk.dim(`${adapter.name}: stopped`);
        }
        printBoxLine(statusText);
      }
    }
    printEmptyLine();
  }

  printFooter();
  log.print("");
}

function renderMenu(
  message: string,
  choices: Array<{ name: string }>,
  selectedIndex: number,
): void {
  const lines = choices.length + 1;
  process.stdout.write(`\x1b[${lines}A`);
  process.stdout.write("\x1b[0J");

  log.print(`${chalk.bold(message)} ${chalk.dim("(use arrow keys, enter, or shortcut)")}`);

  for (let index = 0; index < choices.length; index++) {
    const choice = choices[index];
    const isSelected = index === selectedIndex;
    const prefix = isSelected ? chalk.cyan("> ") : "  ";
    const text = isSelected ? chalk.cyan(choice.name) : choice.name;
    log.print(`${prefix}${text}`);
  }
}

async function rawSelect<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T; key?: string }>,
  cancelValue?: T,
  onRefresh?: (menuLines: number) => Promise<void>,
): Promise<T> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    const result = await select({ message, choices, pageSize: 20 });
    return result as T;
  }

  return new Promise((resolve) => {
    let selectedIndex = 0;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    const keyMap = new Map(
      choices.flatMap((c, i) => (c.key ? [[c.key.toLowerCase(), i] as [string, number]] : [])),
    );

    log.print(`${chalk.bold(message)} ${chalk.dim("(use arrow keys, enter, or shortcut)")}`);
    for (let index = 0; index < choices.length; index++) {
      const choice = choices[index];
      const isSelected = index === selectedIndex;
      const prefix = isSelected ? chalk.cyan("> ") : "  ";
      const text = isSelected ? chalk.cyan(choice.name) : choice.name;
      log.print(`${prefix}${text}`);
    }

    try {
      process.stdin.setRawMode(true);
    } catch {
      resolve(choices[selectedIndex].value);
      return;
    }
    process.stdin.resume();

    process.stdout.write("\x1b[?25l");

    const cleanup = () => {
      if (refreshTimer) clearInterval(refreshTimer);
      process.stdout.write("\x1b[?25h");
      process.stdin.removeListener("data", handler);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };

    const clearMenu = () => {
      const lines = choices.length + 1;
      process.stdout.write(`\x1b[${lines}A\r\x1b[0J`);
    };

    if (onRefresh) {
      refreshTimer = setInterval(async () => {
        if (selectedIndex !== 0) return;
        try {
          await onRefresh(choices.length);
        } catch {}
      }, 10000);
    }

    let escBuf: Buffer = Buffer.alloc(0);
    let escTimer: ReturnType<typeof setTimeout> | null = null;

    const processKey = (buf: Buffer) => {
      if (buf.length === 3 && buf[0] === 0x1b && buf[1] === 0x5b) {
        if (buf[2] === 0x41) {
          selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
          renderMenu(message, choices, selectedIndex);
          return;
        }
        if (buf[2] === 0x42) {
          selectedIndex = (selectedIndex + 1) % choices.length;
          renderMenu(message, choices, selectedIndex);
          return;
        }
        return;
      }

      if (buf.length >= 2 && buf[0] === 0x1b) return;

      const byte = buf[0];

      if (byte === 0x0d) {
        clearMenu();
        cleanup();
        resolve(choices[selectedIndex].value);
        return;
      }

      if (byte === 0x1b) {
        clearMenu();
        cleanup();
        if (cancelValue !== undefined) {
          resolve(cancelValue);
        } else {
          const backChoice = choices.find(
            (c) => c.value === Sentinel.Back || c.value === MainAction.Quit,
          );
          resolve(backChoice?.value ?? (Sentinel.Back as T));
        }
        return;
      }

      if (byte === 0x03) {
        clearMenu();
        cleanup();
        process.exit(0);
      }

      const pressed = String.fromCharCode(byte).toLowerCase();
      const matchIndex = keyMap.get(pressed);
      if (matchIndex !== undefined) {
        clearMenu();
        cleanup();
        resolve(choices[matchIndex].value);
        return;
      }
    };

    const handler = (data: Buffer) => {
      if (data.length === 0) return;

      if (escTimer) {
        clearTimeout(escTimer);
        escTimer = null;
        const combined = Buffer.concat([escBuf, data]);
        escBuf = Buffer.alloc(0);
        processKey(combined);
        return;
      }

      if (data[0] === 0x1b && data.length === 1) {
        escBuf = data;
        escTimer = setTimeout(() => {
          escTimer = null;
          const buf = escBuf;
          escBuf = Buffer.alloc(0);
          processKey(buf);
        }, 50);
        return;
      }

      processKey(data);
    };

    process.stdin.on("data", handler);
  });
}

async function selectWithEscape<T extends string>(
  message: string,
  choices: Array<{ name: string; value: T }>,
  cancelValue: T = "cancel" as T,
): Promise<T> {
  return rawSelect(message, choices, cancelValue);
}

async function selectWithShortcuts(
  message: string,
  choices: MenuChoice[],
  onRefresh?: (menuLines: number) => Promise<void>,
): Promise<string> {
  return rawSelect(message, choices, undefined, onRefresh);
}

async function showAppLogs(): Promise<void> {
  const loggableAdapters = appAdapters.filter((a) => a.logFile() !== null);

  if (loggableAdapters.length === 0) {
    printBoxLine(chalk.dim("No log files available. Start apps first."));
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    return;
  }

  const viewLog = async (adapter: AppAdapter) => {
    const logPath = adapter.logFile();
    if (!logPath || !existsSync(logPath)) {
      printBoxLine(chalk.dim(`No log file found for ${adapter.name}. Has it been started?`));
      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      return;
    }

    process.stdout.write("\x1b[2J\x1b[H");
    log.print(b.divider(`── ${adapter.name} logs ──`) + chalk.dim(" (q or Escape to return)"));
    log.print(chalk.dim(`   ${logPath}`));
    log.print("");

    const tail =
      process.platform === "win32"
        ? spawn("powershell", ["-NoProfile", "-Command", `Get-Content -Path '${logPath}' -Wait`], {
            stdio: ["ignore", "pipe", "pipe"],
          })
        : spawn("tail", ["-f", logPath], { stdio: ["ignore", "pipe", "pipe"] });

    const writeOut = (chunk: Buffer) => {
      try {
        process.stdout.write(chunk);
      } catch {}
    };
    tail.stdout?.on("data", writeOut);
    tail.stderr?.on("data", writeOut);

    const cleanup = () => {
      tail.stdout?.removeListener("data", writeOut);
      tail.stderr?.removeListener("data", writeOut);
      try {
        if (process.platform === "win32" && tail.pid) {
          execSync(`taskkill /PID ${tail.pid} /T /F`, { stdio: "pipe" });
        } else {
          tail.kill("SIGTERM");
        }
      } catch {}
      try {
        tail.stdout?.destroy();
        tail.stderr?.destroy();
      } catch {}
    };

    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
      } catch {
        cleanup();
        return;
      }
      process.stdin.resume();

      await new Promise<void>((resolve) => {
        const handler = (data: Buffer) => {
          const byte = data[0];
          const isQ = byte === 0x71 || byte === 0x51;
          const isEscape = byte === 0x1b && data.length === 1;
          const isCtrlC = byte === 0x03;
          if (isQ || isEscape || isCtrlC) {
            process.stdin.removeListener("data", handler);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            cleanup();
            resolve();
          }
        };

        process.stdin.on("data", handler);
      });
    } else {
      await new Promise<void>((resolve) => {
        tail.on("close", () => resolve());
      });
    }

    log.print("");
  };

  if (loggableAdapters.length === 1) {
    await viewLog(loggableAdapters[0]);
    return;
  }

  while (true) {
    const choices = [
      ...loggableAdapters.map((a) => ({ name: a.name, value: a.name })),
      { name: chalk.dim("← Back"), value: Sentinel.Cancel },
    ];
    const selected = await selectWithEscape("View logs for:", choices, Sentinel.Cancel);
    if (selected === Sentinel.Cancel) return;
    const adapter = loggableAdapters.find((a) => a.name === selected) ?? loggableAdapters[0];
    await viewLog(adapter);
  }
}

async function mainMenu(): Promise<void> {
  const config = localProjectsConfig();

  if (config.projects.length === 0) {
    const isGitRepo = existsSync(join(DEFAULT_ROOT_DIR, ".git"));
    if (isGitRepo) {
      const defaultName = basename(DEFAULT_ROOT_DIR) || "project";
      const defaultProject: ProjectConfig = {
        name: defaultName,
        path: DEFAULT_ROOT_DIR,
      };
      addProject(defaultProject);
      initProject(defaultProject);
    } else {
      log.error("Not a git repository and no projects configured.");
      log.error("Run claude-swarm from a git repository or add projects via the menu.");
      process.exit(1);
    }
  } else {
    const cwdProject = config.projects.find((p) => p.path === DEFAULT_ROOT_DIR);
    if (cwdProject) {
      initProject(cwdProject);
    } else if (existsSync(join(DEFAULT_ROOT_DIR, ".git"))) {
      const defaultName = basename(DEFAULT_ROOT_DIR) || "project";
      const newProject: ProjectConfig = { name: defaultName, path: DEFAULT_ROOT_DIR };
      addProject(newProject);
      initProject(newProject);
    } else {
      const defaultProjectName = config.defaultProject ?? config.projects[0].name;
      const defaultProject = config.projects.find((p) => p.name === defaultProjectName);
      initProject(defaultProject ?? config.projects[0]);
    }
  }

  while (true) {
    await showStatus();

    const sessionCount = managedSessions.size;
    const sessionInfo = sessionCount > 0 ? ` (${sessionCount} running)` : "";
    const padLabel = (text: string, width: number) =>
      text + " ".repeat(Math.max(0, width - text.length));

    const hasRealAdapters = appAdapters.some((a) => !(a instanceof NullAdapter));

    const choices: MenuChoice[] = [
      {
        name: `${padLabel("Manage branches", 28)}${chalk.cyan("[b]")}`,
        value: MainAction.Branches,
        key: "b",
      },
      {
        name: `${padLabel(`Manage sessions${sessionInfo}`, 28)}${chalk.cyan("[s]")}`,
        value: MainAction.Sessions,
        key: "s",
      },
      {
        name: `${padLabel("Pull changes", 28)}${chalk.cyan("[p]")}`,
        value: MainAction.Pull,
        key: "p",
      },
    ];

    if (hasRealAdapters) {
      choices.push({
        name: `${padLabel("Start apps", 28)}${chalk.cyan("[a]")}`,
        value: MainAction.Start,
        key: "a",
      });
      choices.push({
        name: `${padLabel("Stop apps", 28)}${chalk.cyan("[x]")}`,
        value: MainAction.Stop,
        key: "x",
      });
      choices.push({
        name: `${padLabel("View logs", 28)}${chalk.cyan("[l]")}`,
        value: MainAction.Logs,
        key: "l",
      });
    }

    if (process.platform === "win32" && !hasDesktopShortcut(currentProject)) {
      choices.push({
        name: `${padLabel("Create desktop shortcut", 28)}${chalk.cyan("[d]")}`,
        value: MainAction.Shortcut,
        key: "d",
      });
    }

    choices.push({
      name: `${padLabel("Refresh", 28)}${chalk.cyan("[r]")}`,
      value: MainAction.Refresh,
      key: "r",
    });

    choices.push({
      name: chalk.dim(`${padLabel("Quit", 28)}[q]`),
      value: MainAction.Quit,
      key: "q",
    });

    const realAdapters = appAdapters.filter((a) => !(a instanceof NullAdapter));
    const refreshAppStatus =
      realAdapters.length > 0
        ? async (menuLines: number) => {
            const width = boxContentWidth();
            const linesUp = menuLines + 1 + 1 + 1 + 1 + realAdapters.length;
            process.stdout.write(`\x1b[s\x1b[${linesUp}A`);
            for (const adapter of realAdapters) {
              const running = await adapter.isRunning();
              const adapterUrl = adapter.url();
              const error = adapter.lastError();
              const urlSuffix =
                running && adapterUrl
                  ? chalk.cyan(` ${adapterUrl}`) + chalk.dim(" (Ctrl+Click to open)")
                  : "";
              let statusText: string;
              if (error) {
                statusText = chalk.red(`${adapter.name}: failed`) + chalk.dim(` (${error})`);
              } else if (running) {
                statusText = chalk.green(`${adapter.name}: running`) + urlSuffix;
              } else if (adapter.isStarting()) {
                statusText = chalk.yellow(`${adapter.name}: starting...`);
              } else {
                statusText = chalk.dim(`${adapter.name}: stopped`);
              }
              const padded = `  ${statusText}`;
              const stripped = padded.replace(
                new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g"),
                "",
              );
              const pad = Math.max(0, width - stripped.length);
              process.stdout.write(
                `\r${b.content("│")}${padded}${" ".repeat(pad)}${b.content("│")}\x1b[1B`,
              );
            }
            process.stdout.write("\x1b[u");
          }
        : undefined;

    const action = await selectWithShortcuts(
      "What would you like to do?",
      choices,
      refreshAppStatus,
    );

    if (action === MainAction.Branches) {
      await showBranchMenu();
    } else if (action === MainAction.Sessions) {
      await showSessionsMenu();
    } else if (action === MainAction.Pull) {
      await pullChanges();
    } else if (action === MainAction.Start) {
      log.print(chalk.yellow("  Starting apps..."));
      await startAdapters(true);
    } else if (action === MainAction.Stop) {
      await stopAdapters();
    } else if (action === MainAction.Logs) {
      await showAppLogs();
    } else if (action === MainAction.Shortcut) {
      if (createDesktopShortcut(currentProject)) {
        log.info(`Desktop shortcut created for ${currentProject.name}`);
      }
    } else if (action === MainAction.Refresh) {
    } else if (action === MainAction.Quit) {
      const anyRunning = await isAnyAdapterRunning();
      if (anyRunning) {
        if (process.platform === "win32") {
          await stopAdapters();
        } else {
          const confirmQuit = await confirm({
            message: "Apps are still running. Stop them before quitting?",
            default: true,
          });
          if (confirmQuit) {
            await stopAdapters();
          }
        }
      }
      process.stdout.write("\r\n");
      process.exit(0);
    }
  }
}

async function main(): Promise<void> {
  const subcommand = process.argv[2] as Subcommand | undefined;
  const validSubcommands: string[] = Object.values(Subcommand);

  if (subcommand !== undefined && validSubcommands.includes(subcommand)) {
    initProject(currentProject);

    switch (subcommand) {
      case Subcommand.Start:
        await startAdapters();
        break;

      case Subcommand.Stop:
        await stopAdapters();
        break;

      case Subcommand.Restart:
        await stopAdapters();
        await startAdapters();
        break;

      case Subcommand.Status:
        await Promise.all(
          appAdapters.map(async (adapter) => {
            const running = await adapter.isRunning();
            const label = running ? chalk.green("running") : chalk.dim("stopped");
            log.print(`  ${adapter.name}: ${label}`);
          }),
        );
        break;

      case Subcommand.Logs:
        for (const adapter of appAdapters) {
          const logPath = adapter.logFile();
          if (logPath && existsSync(logPath)) {
            log.print(chalk.bold(`\n── ${adapter.name} (${logPath}) ──`));
            log.print(readFileSync(logPath, "utf-8").split("\n").slice(-50).join("\n"));
          } else {
            log.print(chalk.dim(`  ${adapter.name}: no log file found`));
          }
        }
        break;
    }

    return;
  }

  log.info("\n  ⬡ Claude Swarm\n");

  const isGitRepo = existsSync(join(DEFAULT_ROOT_DIR, ".git"));
  if (!isGitRepo) {
    const config = loadProjectsConfig();
    if (config.projects.length === 0) {
      log.error("Error: Not a git repository and no projects configured.");
      process.exit(1);
    }
  }

  await mainMenu();
}

main().catch((error: Error) => {
  log.error(`Error: ${error.message}`);
  process.exit(1);
});
