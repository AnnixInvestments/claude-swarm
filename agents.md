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
