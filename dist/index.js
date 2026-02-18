#!/usr/bin/env node
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface, emitKeypressEvents } from "node:readline";
import { checkbox, confirm, input, select } from "@inquirer/prompts";
import chalk from "chalk";
import { ConfigAdapter, NullAdapter } from "./adapters/index.js";
import { loadProjectsConfig, loadSwarmConfig, saveProjectsConfig } from "./config.js";
import { log } from "./log.js";
var MainAction;
(function (MainAction) {
    MainAction["Branches"] = "branches";
    MainAction["Sessions"] = "sessions";
    MainAction["Pull"] = "pull";
    MainAction["Start"] = "start";
    MainAction["Stop"] = "stop";
    MainAction["Logs"] = "logs";
    MainAction["Refresh"] = "refresh";
    MainAction["Quit"] = "quit";
})(MainAction || (MainAction = {}));
var SessionAction;
(function (SessionAction) {
    SessionAction["New"] = "new";
    SessionAction["PullChanges"] = "pull-changes";
    SessionAction["KillOrphaned"] = "kill-orphaned";
    SessionAction["KillSelect"] = "kill-select";
    SessionAction["Terminate"] = "terminate";
    SessionAction["Back"] = "back";
})(SessionAction || (SessionAction = {}));
var KillMethod;
(function (KillMethod) {
    KillMethod["Graceful"] = "graceful";
    KillMethod["Force"] = "force";
    KillMethod["Cancel"] = "cancel";
})(KillMethod || (KillMethod = {}));
var BranchMenuAction;
(function (BranchMenuAction) {
    BranchMenuAction["Create"] = "create";
    BranchMenuAction["Back"] = "back";
})(BranchMenuAction || (BranchMenuAction = {}));
var BranchAction;
(function (BranchAction) {
    BranchAction["Switch"] = "switch";
    BranchAction["Rebase"] = "rebase";
    BranchAction["Approve"] = "approve";
    BranchAction["Delete"] = "delete";
    BranchAction["Back"] = "back";
})(BranchAction || (BranchAction = {}));
var StartType;
(function (StartType) {
    StartType["Main"] = "main";
    StartType["Issue"] = "issue";
    StartType["Branch"] = "branch";
    StartType["Cancel"] = "cancel";
})(StartType || (StartType = {}));
var BranchPlacement;
(function (BranchPlacement) {
    BranchPlacement["Main"] = "main";
    BranchPlacement["Create"] = "create";
    BranchPlacement["Existing"] = "existing";
    BranchPlacement["Cancel"] = "cancel";
})(BranchPlacement || (BranchPlacement = {}));
var SessionMode;
(function (SessionMode) {
    SessionMode["Interactive"] = "interactive";
    SessionMode["Headless"] = "headless";
    SessionMode["Cancel"] = "cancel";
})(SessionMode || (SessionMode = {}));
var PullChoice;
(function (PullChoice) {
    PullChoice["CherryPickAll"] = "cherry-pick-all";
    PullChoice["CherryPickLatest"] = "cherry-pick-latest";
    PullChoice["Cancel"] = "cancel";
})(PullChoice || (PullChoice = {}));
var CherryPickAbort;
(function (CherryPickAbort) {
    CherryPickAbort["Abort"] = "abort";
    CherryPickAbort["Manual"] = "manual";
})(CherryPickAbort || (CherryPickAbort = {}));
var ProjectAction;
(function (ProjectAction) {
    ProjectAction["AddNew"] = "add-new";
    ProjectAction["Cancel"] = "cancel";
})(ProjectAction || (ProjectAction = {}));
var Sentinel;
(function (Sentinel) {
    Sentinel["Cancel"] = "cancel";
    Sentinel["Back"] = "back";
    Sentinel["CreateNew"] = "create-new";
})(Sentinel || (Sentinel = {}));
const DEFAULT_ROOT_DIR = process.cwd();
const DEFAULT_BRANCH_PREFIX = "claude/";
let currentProject = {
    name: DEFAULT_ROOT_DIR.split("/").pop() ?? "project",
    path: DEFAULT_ROOT_DIR,
};
let claudeBranchPrefix = DEFAULT_BRANCH_PREFIX;
let appAdapters = [new NullAdapter()];
const managedSessions = new Map();
let sessionCounter = 0;
function rootDir() {
    return currentProject.path;
}
function worktreeDir() {
    return (currentProject.worktreeDir ??
        join(currentProject.path, "..", `${currentProject.name.toLowerCase()}-worktrees`));
}
function initProject(project) {
    currentProject = project;
    const swarmConfig = loadSwarmConfig(project.path);
    claudeBranchPrefix = swarmConfig.branchPrefix ?? DEFAULT_BRANCH_PREFIX;
    if (swarmConfig.apps && swarmConfig.apps.length > 0) {
        appAdapters = swarmConfig.apps.map((cfg) => new ConfigAdapter(cfg, project.path));
    }
    else {
        appAdapters = [new NullAdapter()];
    }
}
function localProjectsConfig() {
    return loadProjectsConfig();
}
function persistProjectsConfig(config) {
    saveProjectsConfig(config);
}
function addProject(project) {
    const config = localProjectsConfig();
    const existingIndex = config.projects.findIndex((p) => p.path === project.path);
    const updatedProjects = existingIndex >= 0
        ? config.projects.map((p, i) => (i === existingIndex ? project : p))
        : [...config.projects, project];
    persistProjectsConfig({ ...config, projects: updatedProjects });
}
async function selectProjectForSession() {
    const config = localProjectsConfig();
    const choices = [
        ...config.projects.map((p) => ({
            name: `${p.name} ${chalk.dim(`(${p.path})`)}`,
            value: p.path,
        })),
        { name: chalk.green("+ Add another project"), value: ProjectAction.AddNew },
        { name: chalk.dim("← Cancel"), value: ProjectAction.Cancel },
    ];
    const selected = await selectWithEscape("Select project for this session:", choices, ProjectAction.Cancel);
    if (selected === ProjectAction.Cancel) {
        return null;
    }
    if (selected === ProjectAction.AddNew) {
        const projectPath = await input({
            message: "Enter full path to project:",
            validate: (val) => {
                if (!val.trim())
                    return "Path required";
                if (!existsSync(val.trim()))
                    return "Path does not exist";
                if (!existsSync(join(val.trim(), ".git")))
                    return "Not a git repository";
                return true;
            },
        });
        const trimmedPath = projectPath.trim();
        const defaultName = trimmedPath.split("/").pop() ?? "project";
        const projectName = await input({
            message: "Project name:",
            default: defaultName,
            validate: (val) => (val.trim() ? true : "Name required"),
        });
        const worktreeDirPath = await input({
            message: "Worktree directory (leave blank for default):",
            default: join(trimmedPath, "..", `${projectName.trim().toLowerCase()}-worktrees`),
        });
        const newProject = {
            name: projectName.trim(),
            path: trimmedPath,
            worktreeDir: worktreeDirPath.trim() || undefined,
        };
        addProject(newProject);
        log.info(`Added project: ${newProject.name}`);
        return newProject;
    }
    const project = config.projects.find((p) => p.path === selected);
    return project ?? null;
}
function exec(cmd, options = {}) {
    try {
        return execSync(cmd, {
            cwd: options.cwd ?? rootDir(),
            encoding: "utf-8",
            stdio: options.silent ? "pipe" : ["pipe", "pipe", "pipe"],
        }).trim();
    }
    catch (error) {
        if (!options.silent) {
            log.error(`Command failed: ${cmd}`);
            const stderr = error?.stderr?.toString().trim();
            if (stderr) {
                log.error(stderr);
            }
        }
        return "";
    }
}
function currentBranch() {
    return exec("git branch --show-current");
}
function claudeBranches() {
    const localOutput = exec('git branch --format="%(refname:short)|%(committerdate:relative)|%(subject)"');
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
function allBranches() {
    const output = exec('git branch --format="%(refname:short)"');
    return output.split("\n").filter((line) => line.trim());
}
function formatBranchDisplay(branch, current) {
    const isCurrent = branch.name === current;
    const marker = isCurrent ? chalk.green("●") : chalk.dim("○");
    const name = isCurrent ? chalk.green(branch.name) : branch.name;
    let status = "";
    if (branch.ahead > 0 && branch.behind > 0) {
        status = chalk.yellow(`↑${branch.ahead} ↓${branch.behind}`);
    }
    else if (branch.ahead > 0) {
        status = chalk.green(`↑${branch.ahead} ahead`);
    }
    else if (branch.behind > 0) {
        status = chalk.red(`↓${branch.behind} behind`);
    }
    else {
        status = chalk.dim("up to date");
    }
    const time = branch.lastCommitTime ? chalk.dim(`(${branch.lastCommitTime})`) : "";
    return `${marker} ${name} ${status} ${time}`;
}
function detectClaudeSessions() {
    const seenPids = new Set();
    const sessions = [];
    try {
        const platform = process.platform;
        if (platform === "darwin" || platform === "linux") {
            const output = exec('ps -eo pid,tty,command | grep -E "[c]laude" | grep -v "claude-swarm"', {
                silent: true,
            });
            const lines = output.split("\n").filter((line) => line.trim());
            const result = [];
            for (const line of lines) {
                const match = line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/);
                if (!match)
                    continue;
                const pid = Number.parseInt(match[1], 10);
                const tty = match[2];
                const command = match[3];
                if (seenPids.has(pid) || !command.includes("claude"))
                    continue;
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
                        project = repoRoot.split("/").pop() ?? "unknown";
                    }
                }
                result.push({
                    pid,
                    name: cwd ? (cwd.split("/").pop() ?? "unknown") : `PID ${pid}`,
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
            const winResult = [];
            for (const line of lines) {
                const match = line.match(/"([^"]+)","(\d+)"/);
                if (!match)
                    continue;
                const processName = match[1];
                const pid = Number.parseInt(match[2], 10);
                if (Number.isNaN(pid) || seenPids.has(pid))
                    continue;
                if (!processName.toLowerCase().includes("claude"))
                    continue;
                seenPids.add(pid);
                const hasConsole = exec(`powershell -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).MainWindowHandle -ne 0"`, { silent: true }).trim() === "True";
                winResult.push({
                    pid,
                    name: `PID ${pid}`,
                    branch: "unknown",
                    project: "unknown",
                    status: "working",
                    lastActivity: "active",
                    tty: hasConsole ? "console" : null,
                    isOrphaned: !hasConsole,
                });
            }
            return winResult;
        }
    }
    catch {
        return [];
    }
    return sessions;
}
function killExternalProcess(pid, force = false) {
    try {
        const platform = process.platform;
        if (platform === "win32") {
            try {
                execSync(`taskkill /PID ${pid} /T /F`, { stdio: "pipe" });
            }
            catch {
                execSync(`powershell -Command "Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue"`, { stdio: "pipe" });
            }
        }
        else {
            process.kill(pid, force ? "SIGKILL" : "SIGTERM");
        }
        return true;
    }
    catch {
        return false;
    }
}
function killMultipleProcesses(pids, force = false) {
    const killed = [];
    const failed = [];
    for (const pid of pids) {
        if (killExternalProcess(pid, force)) {
            killed.push(pid);
        }
        else {
            failed.push(pid);
        }
    }
    return { killed, failed };
}
const terminalWidth = () => process.stdout.columns || 80;
const boxContentWidth = () => terminalWidth() - 2;
const BORDER = {
    top: "#001899",
    divider: "#0044bb",
    content: "#0077cc",
    footer: "#00ccff",
};
const b = {
    top: (s) => chalk.bold.hex(BORDER.top)(s),
    divider: (s) => chalk.bold.hex(BORDER.divider)(s),
    content: (s) => chalk.bold.hex(BORDER.content)(s),
    footer: (s) => chalk.bold.hex(BORDER.footer)(s),
};
function gradient(text) {
    const stops = [
        "#00eeff",
        "#00ccff",
        "#00aaff",
        "#0088ff",
        "#0066ff",
        "#2244ff",
        "#4422ff",
        "#6600ff",
    ];
    return text
        .split("")
        .map((ch, i) => chalk.bold.hex(stops[i % stops.length])(ch))
        .join("");
}
function printHeader() {
    process.stdout.write("\x1b[2J\x1b[H");
    const width = boxContentWidth();
    const titleText = "  ⬡  C L A U D E   S W A R M";
    const subtitle = "  parallel sessions · worktree isolation · dev server lifecycle";
    log.print(b.top(`┌${"─".repeat(width)}┐`));
    log.print(b.top("│") +
        gradient(titleText) +
        " ".repeat(Math.max(0, width - titleText.length)) +
        b.top("│"));
    log.print(b.top("│") + chalk.dim(subtitle.padEnd(width)) + b.top("│"));
    log.print(b.divider(`├${"─".repeat(width)}┤`));
}
function printFooter() {
    log.print(b.footer(`└${"─".repeat(boxContentWidth())}┘`));
}
function printSection(title) {
    const width = boxContentWidth();
    const text = `  ${title}`;
    log.print(b.content("│") + chalk.bold(text) + " ".repeat(width - text.length) + b.content("│"));
}
function printBoxLine(content, indent = 2) {
    const stripAnsi = (str) => str.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
    const cleanContent = stripAnsi(content);
    const width = boxContentWidth();
    const maxWidth = width - indent;
    if (cleanContent.length > maxWidth) {
        const truncated = `${cleanContent.slice(0, maxWidth - 1)}…`;
        log.print(b.content("│") + " ".repeat(indent) + truncated + b.content("│"));
    }
    else {
        const padding = maxWidth - cleanContent.length;
        log.print(b.content("│") + " ".repeat(indent) + content + " ".repeat(padding) + b.content("│"));
    }
}
function printEmptyLine() {
    log.print(b.content("│") + " ".repeat(boxContentWidth()) + b.content("│"));
}
async function switchToBranch(branch) {
    log.warn(`\nSwitching to ${branch}...`);
    const result = exec(`git checkout ${branch}`);
    if (result !== undefined) {
        log.info(`Switched to ${branch}`);
    }
}
async function rebaseBranch(branch) {
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
    }
    catch {
        log.error("Rebase failed. Resolve conflicts and run: git rebase --continue");
        return false;
    }
}
async function mergeBranch(branch) {
    log.warn(`\nMerging ${branch} to main (fast-forward)...`);
    exec("git checkout main");
    exec("git fetch origin");
    try {
        execSync("git rebase origin/main", { cwd: rootDir(), stdio: "inherit" });
    }
    catch {
        log.error("Failed to sync main with origin. Resolve conflicts first.");
        return false;
    }
    try {
        execSync(`git merge --ff-only ${branch}`, { cwd: rootDir(), stdio: "inherit" });
        log.info(`Merged ${branch} to main`);
        return true;
    }
    catch {
        log.error("Fast-forward merge failed. Branch may need rebasing first.");
        return false;
    }
}
async function pullChanges() {
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
        }
        catch {
            log.error("Failed to stash changes");
            await confirm({ message: "Press Enter to continue...", default: true });
            return;
        }
    }
    try {
        execSync(`git pull --rebase origin ${branch}`, { cwd: rootDir(), stdio: "inherit" });
        log.info(`Pulled latest changes for ${branch}`);
    }
    catch (error) {
        const errorMsg = error?.stderr?.toString() ?? "";
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
        }
        catch {
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
    const depsChanged = changedFiles.includes("package.json") || changedFiles.includes("pnpm-lock.yaml");
    if (depsChanged) {
        log.warn("Dependencies changed. Running pnpm install...");
        try {
            execSync("pnpm install", { cwd: rootDir(), stdio: "inherit" });
            log.info("Dependencies installed");
        }
        catch {
            log.error("Failed to install dependencies");
        }
    }
}
async function deleteBranch(branch) {
    const worktreeList = exec("git worktree list --porcelain", { silent: true });
    const worktreeMatch = worktreeList.match(new RegExp(`worktree ([^\\n]+)\\n[^\\n]*\\nbranch refs/heads/${branch.replace("/", "\\/")}`, "m"));
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
            }
            catch {
                log.error(`Failed to remove worktree. Delete it manually: git worktree remove "${worktreePath}" --force`);
                return;
            }
        }
        else {
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
        }
        catch {
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
async function startAdapters() {
    const hasRealAdapters = appAdapters.some((a) => !(a instanceof NullAdapter));
    if (!hasRealAdapters) {
        log.print(chalk.dim("  No app adapters configured. Add a .claude-swarm.json to configure dev servers."));
        return;
    }
    await Promise.all(appAdapters.map(async (adapter) => {
        log.print(`  Starting ${adapter.name}...`);
        try {
            await adapter.start();
            log.print(chalk.green(`  ${adapter.name} started`));
        }
        catch (err) {
            log.print(chalk.red(`  Failed to start ${adapter.name}: ${err.message}`));
        }
    }));
}
async function stopAdapters() {
    await Promise.all(appAdapters.map(async (adapter) => {
        log.print(`  Stopping ${adapter.name}...`);
        try {
            await adapter.stop();
            log.print(chalk.dim(`  ${adapter.name} stopped`));
        }
        catch {
            try {
                await adapter.kill();
                log.print(chalk.dim(`  ${adapter.name} killed`));
            }
            catch (err) {
                log.print(chalk.red(`  Failed to stop ${adapter.name}: ${err.message}`));
            }
        }
    }));
}
async function isAnyAdapterRunning() {
    const results = await Promise.all(appAdapters.map((a) => a.isRunning()));
    return results.some(Boolean);
}
async function showBranchMenu() {
    const branches = claudeBranches();
    const current = currentBranch();
    if (branches.length === 0) {
        log.warn(`\nNo ${claudeBranchPrefix}* branches found.`);
        log.info("Claude branches are used for parallel development work.\n");
        const action = await select({
            message: "What would you like to do?",
            choices: [
                { name: `Create a new ${claudeBranchPrefix}* branch`, value: BranchMenuAction.Create },
                { name: chalk.dim("← Back"), value: BranchMenuAction.Back },
            ],
            pageSize: 20,
        });
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
    choices.push({ name: `Create new ${claudeBranchPrefix}* branch`, value: BranchMenuAction.Create }, { name: chalk.dim("← Back"), value: BranchMenuAction.Back });
    const selected = await select({
        message: "Select a branch:",
        choices,
        pageSize: 20,
    });
    if (selected === BranchMenuAction.Back)
        return;
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
async function branchActions(branch) {
    const action = await select({
        message: `Actions for ${branch}:`,
        choices: [
            { name: "Switch to this branch", value: BranchAction.Switch },
            { name: "Rebase onto main", value: BranchAction.Rebase },
            { name: "Approve (rebase + merge + delete)", value: BranchAction.Approve },
            { name: "Delete branch", value: BranchAction.Delete },
            { name: chalk.dim("← Back"), value: BranchAction.Back },
        ],
        pageSize: 20,
    });
    if (action === BranchAction.Switch) {
        await switchToBranch(branch);
    }
    else if (action === BranchAction.Rebase) {
        await rebaseBranch(branch);
    }
    else if (action === BranchAction.Approve) {
        await approveBranch(branch);
    }
    else if (action === BranchAction.Delete) {
        await deleteBranch(branch);
    }
}
async function approveBranch(branch) {
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
async function spawnClaudeSession(options = {}) {
    const { branch, createBranch = false, headless = false, task } = options;
    sessionCounter++;
    const sessionId = `session-${sessionCounter}`;
    const modeLabel = headless ? "headless" : "interactive";
    const sessionName = `Claude ${sessionCounter} (${modeLabel})`;
    const branchName = branch ?? "main";
    const useWorktree = branch && branch !== "main";
    let worktreePath;
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
            }
            else {
                exec(`git worktree add "${worktreePath}" ${branch}`, { silent: false });
            }
            if (!existsSync(worktreePath)) {
                log.error(`Failed to create worktree at ${worktreePath}`);
                return;
            }
        }
        else {
            log.info(`Using existing worktree at ${worktreePath}`);
        }
    }
    log.warn(`\nStarting new Claude Code session on ${branchName} (${modeLabel})...`);
    if (task) {
        log.info(`Task: ${task.slice(0, 60)}${task.length > 60 ? "..." : ""}`);
    }
    const isWindows = process.platform === "win32";
    let taskFile = null;
    if (task) {
        const tempDir = mkdtempSync(join(tmpdir(), "claude-task-"));
        taskFile = join(tempDir, "task.txt");
        writeFileSync(taskFile, task, "utf-8");
    }
    let claudeCmd = "claude";
    if (headless) {
        claudeCmd = taskFile
            ? `cat '${taskFile}' | claude --dangerously-skip-permissions`
            : "claude --dangerously-skip-permissions";
    }
    else if (taskFile) {
        claudeCmd = `cat '${taskFile}' | claude`;
    }
    let sessionProcess;
    if (isWindows) {
        let winCmd = "claude";
        if (headless) {
            winCmd = taskFile
                ? `claude --dangerously-skip-permissions < "${taskFile}"`
                : "claude --dangerously-skip-permissions";
        }
        else if (taskFile) {
            winCmd = `type "${taskFile}" | claude`;
        }
        const hasWindowsTerminal = exec("where wt", { silent: true }) !== "";
        if (hasWindowsTerminal) {
            const claudePath = exec("where claude.cmd", { silent: true }).split("\n")[0].trim();
            const fullWinCmd = winCmd.replace(/^claude/, `"${claudePath}"`);
            const wtCmd = `wt -w -1 new-tab --title "Claude ${sessionCounter}" -d "${sessionDir}" ${fullWinCmd}`;
            sessionProcess = spawn(wtCmd, [], {
                cwd: rootDir(),
                detached: true,
                stdio: "ignore",
                shell: true,
            });
        }
        else {
            sessionProcess = spawn("cmd", ["/c", "start", "cmd", "/k", winCmd], {
                cwd: sessionDir,
                detached: true,
                stdio: "ignore",
            });
        }
    }
    else {
        const terminalApp = process.env.TERM_PROGRAM === "iTerm.app" ? "iTerm" : "Terminal";
        const shellCmd = `cd "${sessionDir}" && ${claudeCmd}`;
        const escapeForAppleScript = (cmd) => cmd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const escapedShellCmd = escapeForAppleScript(shellCmd);
        if (terminalApp === "iTerm") {
            try {
                execSync(`osascript <<EOF
tell application "iTerm"
  tell current window
    create tab with default profile
    tell current session
      write text "${escapedShellCmd}"
    end tell
  end tell
end tell
EOF`, { cwd: rootDir(), stdio: "inherit" });
            }
            catch {
                try {
                    execSync(`osascript <<EOF
tell application "iTerm"
  activate
  create window with default profile
  tell current session of current window
    write text "${escapedShellCmd}"
  end tell
end tell
EOF`, { cwd: rootDir(), stdio: "inherit" });
                }
                catch {
                    execSync(`osascript -e 'tell application "Terminal" to do script "${escapedShellCmd}"'`, {
                        cwd: rootDir(),
                        stdio: "inherit",
                    });
                }
            }
        }
        else {
            execSync(`osascript -e 'tell application "Terminal" to do script "${escapedShellCmd}" in front window'`, { cwd: rootDir(), stdio: "inherit" });
        }
        sessionProcess = spawn("echo", ["Session started in new terminal"], {
            cwd: rootDir(),
            detached: true,
            stdio: "ignore",
        });
    }
    sessionProcess.unref();
    const session = {
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
    };
    managedSessions.set(sessionId, session);
    log.info(`${sessionName} started on branch ${branchName}`);
    if (headless) {
        log.warn("  Headless mode: Claude will auto-accept all actions");
    }
}
async function terminateSession(sessionId) {
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
    try {
        if (session.process.pid) {
            process.kill(session.process.pid, "SIGTERM");
        }
        session.status = "stopped";
        log.info(`${session.name} terminated.`);
    }
    catch {
        log.warn("Note: Session may need to be closed manually in its terminal.");
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
            }
            catch {
                log.warn(`Could not remove worktree. Remove manually with: git worktree remove "${session.worktreePath}"`);
            }
        }
    }
    managedSessions.delete(sessionId);
}
async function pullChangesFromBranch(branch) {
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
    const pullChoice = await selectWithEscape("What would you like to do?", [
        { name: "Cherry-pick all commits to main (for testing)", value: PullChoice.CherryPickAll },
        { name: "Cherry-pick latest commit only", value: PullChoice.CherryPickLatest },
        { name: chalk.dim("← Cancel"), value: PullChoice.Cancel },
    ], PullChoice.Cancel);
    if (pullChoice === PullChoice.Cancel)
        return;
    const latestCommit = commits[0].split(" ")[0];
    const oldestCommit = commits[commits.length - 1].split(" ")[0];
    const cherryPickWithRetry = async (commitRange) => {
        try {
            execSync(`git cherry-pick -X theirs ${commitRange}`, { cwd: rootDir(), stdio: "inherit" });
            return true;
        }
        catch {
            log.error("Cherry-pick failed.");
            const abortChoice = await selectWithEscape("What would you like to do?", [
                { name: "Abort and return to menu", value: CherryPickAbort.Abort },
                { name: "Leave as-is for manual resolution", value: CherryPickAbort.Manual },
            ], CherryPickAbort.Abort);
            if (abortChoice === CherryPickAbort.Abort) {
                try {
                    execSync("git cherry-pick --abort", { cwd: rootDir(), stdio: "pipe" });
                    log.info("Cherry-pick aborted.");
                }
                catch { }
            }
            else {
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
    }
    else {
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
async function showSessionsMenu() {
    while (true) {
        const detectedSessions = detectClaudeSessions();
        const managed = Array.from(managedSessions.values());
        const attachedSessions = detectedSessions.filter((s) => !s.isOrphaned);
        const orphanedSessions = detectedSessions.filter((s) => s.isOrphaned);
        log.print(`\n${chalk.bold("=== Claude Sessions ===")}\n`);
        log.print(chalk.bold("Managed Sessions:"));
        if (managed.length === 0) {
            log.print(chalk.dim("  No sessions started from this manager."));
        }
        else {
            for (const session of managed) {
                const runtime = Math.round((Date.now() - session.startTime.getTime()) / 60000);
                const statusColor = session.status === "running" ? chalk.green : chalk.dim;
                const modeIcon = session.headless ? "headless" : "interactive";
                const projectLabel = chalk.bold(session.project.name);
                const taskPreview = session.task
                    ? chalk.dim(` "${session.task.slice(0, 40)}${session.task.length > 40 ? "..." : ""}"`)
                    : "";
                log.print(`  ${statusColor("●")} [${modeIcon}] ${projectLabel} ${chalk.cyan(session.branch)} [${runtime}m]${taskPreview}`);
            }
        }
        log.print(`\n${chalk.bold("Active Sessions (attached to terminal):")}`);
        if (attachedSessions.length === 0) {
            log.print(chalk.dim("  No active sessions detected."));
        }
        else {
            for (const session of attachedSessions) {
                const projectDisplay = session.project !== "unknown"
                    ? chalk.bold(session.project)
                    : chalk.dim("unknown project");
                const branchDisplay = session.branch !== "unknown" ? chalk.cyan(session.branch) : chalk.dim("unknown branch");
                const ttyDisplay = session.tty ? chalk.dim(` [${session.tty}]`) : "";
                log.print(`  ${chalk.green("●")} ${projectDisplay} on ${branchDisplay} (PID ${session.pid})${ttyDisplay}`);
            }
        }
        log.print(`\n${chalk.bold("Orphaned Sessions (detached from terminal):")}`);
        if (orphanedSessions.length === 0) {
            log.print(chalk.dim("  No orphaned sessions detected."));
        }
        else {
            for (const session of orphanedSessions) {
                const projectDisplay = session.project !== "unknown"
                    ? chalk.bold(session.project)
                    : chalk.dim("unknown project");
                const branchDisplay = session.branch !== "unknown" ? chalk.cyan(session.branch) : chalk.dim("unknown branch");
                log.print(`  ${chalk.red("●")} ${projectDisplay} on ${branchDisplay} (PID ${session.pid}) ${chalk.red("[orphaned]")}`);
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
        if (action === SessionAction.Back)
            return;
        if (action === SessionAction.KillOrphaned) {
            const killMethod = await selectWithEscape("How to kill orphaned sessions?", [
                { name: "Graceful (SIGTERM) - allows cleanup", value: KillMethod.Graceful },
                { name: "Force (SIGKILL) - immediate termination", value: KillMethod.Force },
                { name: chalk.dim("← Cancel"), value: KillMethod.Cancel },
            ], KillMethod.Cancel);
            if (killMethod === KillMethod.Cancel)
                continue;
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
                    log.warn(`Failed to kill ${result.failed.length} session(s): PIDs ${result.failed.join(", ")}`);
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
            const killMethod = await selectWithEscape("How to kill selected sessions?", [
                { name: "Graceful (SIGTERM) - allows cleanup", value: KillMethod.Graceful },
                { name: "Force (SIGKILL) - immediate termination", value: KillMethod.Force },
                { name: chalk.dim("← Cancel"), value: KillMethod.Cancel },
            ], KillMethod.Cancel);
            if (killMethod === KillMethod.Cancel)
                continue;
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
                    log.warn(`Failed to kill ${result.failed.length} session(s): PIDs ${result.failed.join(", ")}`);
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
            const selectedBranch = await selectWithEscape("Pull changes from which branch?", branchChoices, Sentinel.Cancel);
            if (selectedBranch !== Sentinel.Cancel) {
                await pullChangesFromBranch(selectedBranch);
            }
            continue;
        }
        if (action === SessionAction.New) {
            const selectedProject = await selectProjectForSession();
            if (!selectedProject)
                continue;
            initProject(selectedProject);
            log.info(`Working in: ${selectedProject.name}`);
            const startType = await selectWithEscape("How would you like to start?", [
                { name: "Quick start on main (Recommended)", value: StartType.Main },
                { name: "Start with GitHub issue", value: StartType.Issue },
                { name: "Start on specific branch", value: StartType.Branch },
                { name: chalk.dim("← Cancel"), value: StartType.Cancel },
            ], StartType.Cancel);
            if (startType === StartType.Cancel)
                continue;
            let selectedBranch;
            let task;
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
                let issues = [];
                try {
                    issues = JSON.parse(issuesJson);
                }
                catch {
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
                const selectedIssue = await selectWithEscape("Select an issue:", issueChoices, Sentinel.Cancel);
                if (selectedIssue === Sentinel.Cancel)
                    continue;
                const issueJson = exec(`gh issue view ${selectedIssue} --json title,body`, {
                    silent: true,
                });
                if (issueJson) {
                    try {
                        const issue = JSON.parse(issueJson);
                        task = `GitHub Issue #${selectedIssue}: ${issue.title}\n\n${issue.body}`;
                        log.info(`Selected: ${issue.title}`);
                    }
                    catch {
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
                const branchChoice = await selectWithEscape("Where should this session work?", branchChoiceOptions, BranchPlacement.Cancel);
                if (branchChoice === BranchPlacement.Cancel)
                    continue;
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
                }
                else if (branchChoice === BranchPlacement.Existing) {
                    const existingBranchChoices = [
                        ...existingBranches.map((b) => ({ name: b.name, value: b.name })),
                        { name: chalk.dim("← Cancel"), value: Sentinel.Cancel },
                    ];
                    selectedBranch = await selectWithEscape("Select existing branch:", existingBranchChoices, Sentinel.Cancel);
                    if (selectedBranch === Sentinel.Cancel)
                        continue;
                }
                else {
                    selectedBranch = "main";
                }
            }
            else if (startType === StartType.Branch) {
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
                selectedBranch = await selectWithEscape("Select branch (will use/create worktree):", branchChoices, StartType.Cancel);
                if (selectedBranch === StartType.Cancel)
                    continue;
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
            }
            else {
                selectedBranch = "main";
            }
            const mode = await selectWithEscape("Session mode:", [
                {
                    name: "Interactive - prompts for confirmation (Recommended)",
                    value: SessionMode.Interactive,
                },
                { name: "Headless - auto-accepts all actions", value: SessionMode.Headless },
                { name: chalk.dim("← Cancel"), value: SessionMode.Cancel },
            ], SessionMode.Cancel);
            if (mode === SessionMode.Cancel)
                continue;
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
        }
        else if (action === SessionAction.Terminate) {
            const sessionChoices = Array.from(managedSessions.values()).map((s) => ({
                name: `${s.name} on ${s.branch}`,
                value: s.id,
            }));
            sessionChoices.push({ name: chalk.dim("← Cancel"), value: SessionAction.Back });
            const selectedSession = await selectWithEscape("Select session to terminate:", sessionChoices, SessionAction.Back);
            if (selectedSession !== SessionAction.Back) {
                await terminateSession(selectedSession);
            }
        }
    }
}
async function showStatus() {
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
    }
    else {
        for (const branch of branches) {
            const display = formatBranchDisplay(branch, current);
            printBoxLine(display);
        }
    }
    printEmptyLine();
    printSection("Sessions");
    if (managed.length === 0) {
        printBoxLine(chalk.dim("No managed sessions"));
    }
    else {
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
    const anyRunning = await isAnyAdapterRunning();
    const hasRealAdapters = appAdapters.some((a) => !(a instanceof NullAdapter));
    if (hasRealAdapters) {
        printSection("Apps");
        for (const adapter of appAdapters) {
            if (!(adapter instanceof NullAdapter)) {
                const statusText = anyRunning
                    ? chalk.green(`${adapter.name}: running`)
                    : chalk.dim(`${adapter.name}: stopped`);
                printBoxLine(statusText);
            }
        }
        printEmptyLine();
    }
    printFooter();
    log.print("");
}
async function selectWithEscape(message, choices, _cancelValue = "cancel") {
    const result = await select({ message, choices, pageSize: 20 });
    return result;
}
function renderMenu(message, choices, selectedIndex) {
    const lines = choices.length + 1;
    process.stdout.write(`\x1b[${lines}A`);
    process.stdout.write("\x1b[0J");
    log.print(`${chalk.bold.green("?")} ${chalk.bold(message)} ${chalk.dim("(use arrow keys, enter, or shortcut)")}`);
    for (let index = 0; index < choices.length; index++) {
        const choice = choices[index];
        const isSelected = index === selectedIndex;
        const prefix = isSelected ? chalk.cyan("> ") : "  ";
        const text = isSelected ? chalk.cyan(choice.name) : choice.name;
        log.print(`${prefix}${text}`);
    }
}
async function selectWithShortcuts(message, choices) {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
        const result = await select({
            message,
            choices: choices.map((c) => ({ name: c.name, value: c.value })),
            pageSize: 20,
        });
        return result;
    }
    return new Promise((resolve) => {
        let selectedIndex = 0;
        const keyMap = new Map(choices.map((c, i) => [c.key.toLowerCase(), i]));
        log.print(`${chalk.bold.green("?")} ${chalk.bold(message)} ${chalk.dim("(use arrow keys, enter, or shortcut)")}`);
        for (let index = 0; index < choices.length; index++) {
            const choice = choices[index];
            const isSelected = index === selectedIndex;
            const prefix = isSelected ? chalk.cyan("> ") : "  ";
            const text = isSelected ? chalk.cyan(choice.name) : choice.name;
            log.print(`${prefix}${text}`);
        }
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        emitKeypressEvents(process.stdin, rl);
        try {
            process.stdin.setRawMode(true);
        }
        catch {
            rl.close();
            resolve(choices[selectedIndex].value);
            return;
        }
        const cleanup = () => {
            process.stdin.setRawMode(false);
            process.stdin.removeAllListeners("keypress");
            rl.close();
        };
        const handler = (_str, key) => {
            if (!key)
                return;
            if (key.name === "up") {
                selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
                renderMenu(message, choices, selectedIndex);
                return;
            }
            if (key.name === "down") {
                selectedIndex = (selectedIndex + 1) % choices.length;
                renderMenu(message, choices, selectedIndex);
                return;
            }
            const clearMenu = () => {
                const lines = choices.length + 1;
                process.stdout.write(`\x1b[${lines}A\x1b[0J`);
            };
            if (key.name === "return") {
                cleanup();
                clearMenu();
                resolve(choices[selectedIndex].value);
                return;
            }
            if (key.name === "escape") {
                cleanup();
                clearMenu();
                const backChoice = choices.find((c) => c.value === Sentinel.Back || c.value === MainAction.Quit);
                resolve(backChoice?.value ?? Sentinel.Back);
                return;
            }
            if (key.ctrl && key.name === "c") {
                cleanup();
                process.exit(0);
            }
            const pressed = (key.name ?? key.sequence ?? "").toLowerCase();
            const matchIndex = keyMap.get(pressed);
            if (matchIndex !== undefined) {
                cleanup();
                clearMenu();
                resolve(choices[matchIndex].value);
                return;
            }
        };
        process.stdin.on("keypress", handler);
    });
}
async function showAppLogs() {
    const loggableAdapters = appAdapters.filter((a) => a.logFile() !== null);
    if (loggableAdapters.length === 0) {
        printBoxLine(chalk.dim("No log files available. Start apps first."));
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return;
    }
    let adapter = loggableAdapters[0];
    if (loggableAdapters.length > 1) {
        const choices = [
            ...loggableAdapters.map((a) => ({ name: a.name, value: a.name })),
            { name: chalk.dim("← Cancel"), value: Sentinel.Cancel },
        ];
        const selected = await selectWithEscape("View logs for:", choices, Sentinel.Cancel);
        if (selected === Sentinel.Cancel)
            return;
        adapter = loggableAdapters.find((a) => a.name === selected) ?? loggableAdapters[0];
    }
    const logPath = adapter.logFile();
    if (!logPath || !existsSync(logPath)) {
        printBoxLine(chalk.dim(`No log file found for ${adapter.name}. Has it been started?`));
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return;
    }
    process.stdout.write("\x1b[2J\x1b[H");
    log.print(b.divider(`── ${adapter.name} logs ──`) + chalk.dim(" (q or Escape to return)"));
    log.print(chalk.dim(`   ${logPath}`));
    log.print("");
    const tail = process.platform === "win32"
        ? spawn("powershell", ["-Command", `Get-Content -Path '${logPath}' -Wait`], {
            stdio: ["ignore", "pipe", "pipe"],
        })
        : spawn("tail", ["-f", logPath], { stdio: ["ignore", "pipe", "pipe"] });
    tail.stdout?.pipe(process.stdout);
    tail.stderr?.pipe(process.stderr);
    const stopTail = () => tail.kill("SIGTERM");
    if (process.stdin.isTTY) {
        process.stdin.resume();
        emitKeypressEvents(process.stdin);
        process.stdin.setRawMode(true);
        process.stdin.on("keypress", (_str, key) => {
            if (!key)
                return;
            if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) {
                stopTail();
            }
        });
    }
    await new Promise((resolve) => {
        tail.on("close", () => resolve());
    });
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
    }
    process.stdin.removeAllListeners("keypress");
    log.print("");
}
async function mainMenu() {
    const config = localProjectsConfig();
    if (config.projects.length === 0) {
        const isGitRepo = existsSync(join(DEFAULT_ROOT_DIR, ".git"));
        if (isGitRepo) {
            const defaultName = DEFAULT_ROOT_DIR.split("/").pop() ?? "project";
            const defaultProject = {
                name: defaultName,
                path: DEFAULT_ROOT_DIR,
            };
            addProject(defaultProject);
            initProject(defaultProject);
        }
        else {
            log.error("Not a git repository and no projects configured.");
            log.error("Run claude-swarm from a git repository or add projects via the menu.");
            process.exit(1);
        }
    }
    else {
        const defaultProjectName = config.defaultProject ?? config.projects[0].name;
        const defaultProject = config.projects.find((p) => p.name === defaultProjectName);
        if (defaultProject) {
            initProject(defaultProject);
        }
        else {
            initProject(config.projects[0]);
        }
    }
    while (true) {
        await showStatus();
        const sessionCount = managedSessions.size;
        const sessionInfo = sessionCount > 0 ? ` (${sessionCount} running)` : "";
        const padLabel = (text, width) => text + " ".repeat(Math.max(0, width - text.length));
        const hasRealAdapters = appAdapters.some((a) => !(a instanceof NullAdapter));
        const choices = [
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
        const action = await selectWithShortcuts("What would you like to do?", choices);
        if (action === MainAction.Branches) {
            await showBranchMenu();
        }
        else if (action === MainAction.Sessions) {
            await showSessionsMenu();
        }
        else if (action === MainAction.Pull) {
            await pullChanges();
        }
        else if (action === MainAction.Start) {
            await startAdapters();
        }
        else if (action === MainAction.Stop) {
            await stopAdapters();
        }
        else if (action === MainAction.Logs) {
            await showAppLogs();
        }
        else if (action === MainAction.Refresh) {
        }
        else if (action === MainAction.Quit) {
            const anyRunning = await isAnyAdapterRunning();
            if (anyRunning) {
                const confirmQuit = await confirm({
                    message: "Apps are still running. Stop them before quitting?",
                    default: true,
                });
                if (confirmQuit) {
                    await stopAdapters();
                }
            }
            log.debug("\nGoodbye!");
            process.exit(0);
        }
    }
}
async function main() {
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
main().catch((error) => {
    log.error(`Error: ${error.message}`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map