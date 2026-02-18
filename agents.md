# Agent Guidelines

This document provides guidance for AI code assistants working in this repository.

## CRITICAL RULES - READ FIRST

These rules MUST be followed in EVERY session without exception:

### 1. NO CODE COMMENTS
- **NEVER add comments to code** - use self-documenting method names instead
- This includes `//`, `/* */`, and any explanatory text in code
- Avoid sprinkling comments into the source. Favor self-documenting functions, descriptive names, and clean structure.
- When additional context is needed, update this file (or other prompt infrastructure) instead of writing comments directly in code.

### 2. NO AI ATTRIBUTION IN COMMITS
- **NEVER add AI attribution to commit messages**
- This means NO:
    - `Generated with [Claude Code](https://claude.ai/code)`
    - `Co-Authored-By: Claude <noreply@anthropic.com>`
    - Any similar AI tool attribution lines
- Commits should appear as if written by a human developer

## Project Context

`claude-swarm` is a standalone TypeScript CLI tool that manages multiple parallel Claude Code sessions with git worktree isolation and dev-server lifecycle management.

It lives at `../claude-swarm` relative to the `annix` monorepo and is invoked via:

```
pnpm claude-swarm   # from annix root
../claude-swarm/bin/claude-swarm   # directly
```

The entry point is `src/index.ts`, compiled to `dist/index.js` via `npm run build`.

The bin launcher at `bin/claude-swarm` auto-installs and auto-builds using content hashes, so it only runs `npm install`/`npm run build` when files actually change.

### Architecture

- `src/index.ts` — TUI, session management, branch management, main menu loop, enums for all menu action values
- `src/config.ts` — projects config (`~/.config/claude-swarm/projects.json`) and swarm config (`.claude-swarm.json` in project root)
- `src/log.ts` — logging utilities
- `src/adapters/` — dev-server lifecycle adapters:
  - `AppAdapter.ts` — interface (`name`, `start`, `stop`, `kill`, `isRunning`, `logFile`)
  - `DevServerAdapter.ts` — abstract base class (shared logic for NestAdapter, NextAdapter, ViteAdapter)
  - `ConfigAdapter.ts` — JSON-config-driven adapter; reads `.claude-swarm.json`; streams stdout/stderr to `.claude-swarm-<name>.log`
  - `NullAdapter.ts` — no-op fallback when no apps are configured

### Enum conventions

All menu action string values are declared as TypeScript string enums in `src/index.ts`. When adding new menu items, add a value to the relevant enum rather than using plain string literals:

| Enum | Used in |
|------|---------|
| `MainAction` | Main menu |
| `SessionAction` | Sessions sub-menu |
| `BranchMenuAction` | Branch list menu (create/back sentinels) |
| `BranchAction` | Branch action menu (switch/rebase/approve/delete/back) |
| `StartType` | New session start type |
| `BranchPlacement` | Issue session branch placement |
| `SessionMode` | Interactive vs headless |
| `KillMethod` | Graceful vs force kill |
| `PullChoice` | Cherry-pick options |
| `CherryPickAbort` | Cherry-pick failure resolution |
| `ProjectAction` | Project selector (add-new/cancel) |
| `Sentinel` | Mixed-type selects where the value can be a dynamic string OR a sentinel (`cancel`, `back`, `create-new`) |

### Adapter lifecycle contract

`ConfigAdapter` drives stop/kill in two phases:

1. Runs the user-supplied shell command (e.g. `lsof -ti:4001 | xargs kill -15`) — this typically kills the bound port process.
2. Immediately calls `sendSignalToChildren(SIGTERM/SIGKILL)` — this runs `pkill -f "<start-command>"` to also kill the pnpm launcher process that invoked the script.

Both phases are needed because `isRunning()` uses `pgrep -f "<start-command>"` to detect the launcher. Without step 2, the launcher stays alive after a port-based stop, causing `isRunning()` to return `true` even though nothing is serving.

`showStatus()` calls each adapter's `isRunning()` individually so each app shows its own real status, not a shared boolean.

### Windows compatibility

Platform-specific branches are needed in several places. The pattern used throughout:

```typescript
if (process.platform === "win32") {
  // PowerShell / Windows equivalent
  return;
}
// Unix path
```

**Already handled (Windows branches exist):**
- `spawnClaudeSession()` — Windows Terminal / cmd fallback
- `detectClaudeSessions()` — uses `tasklist` instead of `ps`
- `killExternalProcess()` — uses `taskkill` / PowerShell `Stop-Process`
- `showAppLogs()` — uses `Get-Content -Wait` instead of `tail -f`
- `ConfigAdapter.isRunning()` — uses `Get-CimInstance Win32_Process` CIM query
- `ConfigAdapter.sendSignalToChildren()` — uses PowerShell `Stop-Process`
- `DevServerAdapter.isRunning()` — uses `Get-NetTCPConnection`
- `DevServerAdapter.stop/kill()` — uses PowerShell `Stop-Process`
- `ProcessAdapter.isRunning()` — uses `Get-CimInstance Win32_Process` CIM query

**Path handling:** Use `path.basename()` instead of `split("/").pop()` — `basename()` handles both `\` and `/` separators correctly on all platforms.

**`bin/claude-swarm`:** The bash dev-launcher is Mac/Linux only. On Windows, the tool is invoked via the npm/pnpm bin (`dist/index.js`) directly — the bash script is never needed.

**Windows `.claude-swarm.json` config:** The `stop` and `kill` commands in project configs must use Windows-compatible commands. On Mac/Linux these typically use `lsof`/`kill`; on Windows use `netstat`/`taskkill` or PowerShell equivalents.

### Local development testing

To test a local build of claude-swarm from the annix project without publishing:

```bash
cd annix
pnpm link ../claude-swarm   # symlinks node_modules/@annix/claude-swarm → ../claude-swarm
```

To restore the released version:

```bash
cd annix
pnpm install                 # re-fetches from github:AnnixInvestments/claude-swarm
```

After any source change in `claude-swarm/src/`, run `npm run build` in the claude-swarm repo (the `bin/claude-swarm` launcher will also do this automatically if the hash is stale).

### Log files

`ConfigAdapter` streams all stdout/stderr to `.claude-swarm-<name>.log` in the project directory. These files are gitignored via `.claude-swarm-*.log`. The TUI "View logs [l]" menu tails the log file live using `tail -f`.

### Git Hooks
- Hooks live in `.githooks/` — activate with `git config core.hooksPath .githooks`
- `pre-commit` — secret detection scan
- `commit-msg` — blocks AI attribution lines
- `pre-push` — runs lint and build before any push

### Remotes
- `origin` — `https://github.com/AnnixInvestments/claude-swarm.git`

## Dev Scripts

Run all commands from the repository root (`claude-swarm/`).

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run directly with ts-node (no compile step) |
| `npm run start` | Run compiled output |
| `npm run lint` | Biome lint check on `src/` |
| `npm run format` | Auto-format `src/` with Biome |
| `npm run format:check` | Check formatting without fixing |
| `npm run typecheck` | TypeScript type-check without emitting |
