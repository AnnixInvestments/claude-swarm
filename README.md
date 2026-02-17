# claude-swarm

Manage multiple parallel Claude CLI sessions with worktree isolation and pluggable dev server lifecycle management.

## Features

- **Session Management**: Detect, spawn, and terminate Claude CLI sessions
- **Worktree Isolation**: Run parallel sessions in separate git worktrees
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **GitHub Integration**: Start sessions from GitHub issues
- **Process Detection**: Distinguish between active (terminal-attached) and orphaned (detached) sessions
- **Cleanup Tools**: Kill orphaned sessions individually or in bulk
- **Pluggable App Adapters**: Manage dev servers for any project via config or built-in adapters
- **Live Log Viewing**: Tail dev server logs inside the TUI

## Installation

```sh
npm install -g claude-swarm
# or run directly via the launcher
../claude-swarm/bin/claude-swarm
```

## Usage

Run from any git repository:

```sh
claude-swarm
```

The tool will detect the current project and load configuration from `.claude-swarm.json` in the current directory if present.

## Project configuration

### `.claude-swarm.json`

Create a `.claude-swarm.json` in your project root to configure the branch prefix and dev servers:

```json
{
  "branchPrefix": "claude/",
  "apps": [
    {
      "name": "backend",
      "start": "pnpm dev:backend",
      "stop": "lsof -ti:4001 | xargs kill -15 2>/dev/null; true",
      "kill": "lsof -ti:4001 | xargs kill -9 2>/dev/null; true",
      "readyPattern": "Nest application successfully started"
    },
    {
      "name": "frontend",
      "start": "pnpm dev:frontend",
      "stop": "lsof -ti:3000 | xargs kill -15 2>/dev/null; true",
      "kill": "lsof -ti:3000 | xargs kill -9 2>/dev/null; true",
      "readyPattern": "Ready in"
    }
  ]
}
```

### Configuration fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `branchPrefix` | `string` | `"claude/"` | Prefix for Claude-managed branches |
| `apps` | `AppAdapterConfig[]` | `[]` | Dev server definitions |

### App adapter config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Display name shown in the TUI |
| `start` | `string` | Yes | Shell command to start the server |
| `stop` | `string` | Yes | Shell command or signal to stop gracefully (e.g. `signal:SIGTERM`) |
| `kill` | `string` | Yes | Shell command or signal to force-stop (e.g. `signal:SIGKILL`, or `lsof -ti:PORT | xargs kill -9`) |
| `readyPattern` | `string` | No | Regex to match against stdout/stderr to detect when the server is ready |

When `readyPattern` is set, `start` blocks until the pattern matches or the 120 second timeout elapses.

Dev server output is always streamed to `.claude-swarm-<name>.log` in the project directory, regardless of whether `readyPattern` is set. Add `.claude-swarm-*.log` to your `.gitignore`.

### Stop vs Kill commands

- **stop**: Sent first; should request graceful shutdown (e.g. SIGTERM or port-based kill -15)
- **kill**: Fallback if stop throws; should force-terminate (e.g. SIGKILL or port-based kill -9)

Use port-based kill commands (via `lsof`) for processes spawned through npm/pnpm scripts, as the script process PID differs from the actual server PID:

```
"stop": "lsof -ti:4001 | xargs kill -15 2>/dev/null; true"
"kill": "lsof -ti:4001 | xargs kill -9 2>/dev/null; true"
```

Use signal format for processes you start directly:

```
"stop": "signal:SIGTERM"
"kill": "signal:SIGKILL"
```

## Multi-project support

claude-swarm manages sessions across multiple projects. On first run it detects the current git repo and adds it automatically. Additional projects can be added interactively via the session menu.

Project configurations are saved to `~/.config/claude-swarm/projects.json`. This is a user-level config file shared across all invocations.

### `~/.config/claude-swarm/projects.json`

```json
{
  "projects": [
    {
      "name": "myapp",
      "path": "/Users/you/dev/myapp",
      "worktreeDir": "/Users/you/dev/myapp-worktrees"
    }
  ],
  "defaultProject": "myapp"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `projects[].name` | `string` | Display name |
| `projects[].path` | `string` | Absolute path to the git repo root |
| `projects[].worktreeDir` | `string` | Where worktrees are created (default: `../name-worktrees` sibling) |
| `defaultProject` | `string` | Name of the project to select on startup |

## Bin launcher

The `bin/claude-swarm` script provides hash-based auto-install/build: it only runs `npm install` or `npm run build` when `package-lock.json` or `src/` files have changed since the last run. This means subsequent invocations start instantly.

```sh
# From annix:
pnpm claude-swarm

# Directly:
../claude-swarm/bin/claude-swarm
```

## Branch workflow

Claude sessions work on branches with the configured prefix (default `claude/`). The TUI provides:

- **Branch listing** — all claude branches with ahead/behind status
- **Rebase** — rebase a claude branch onto main
- **Approve** — rebase + fast-forward merge + delete in one step
- **Cherry-pick** — pull specific commits from a claude branch for testing on main

## App Adapter interface

You can use the built-in adapters programmatically:

```typescript
import {
  AppAdapter,
  NestAdapter,
  NextAdapter,
  ViteAdapter,
  NullAdapter,
  ConfigAdapter,
  DevServerAdapter,
} from "claude-swarm";
```

### Built-in adapters

| Adapter | Description |
|---------|-------------|
| `NestAdapter` | NestJS backend (`nest start --watch`) |
| `NextAdapter` | Next.js frontend (`next dev`) |
| `ViteAdapter` | Vite dev server (`vite`) |
| `NullAdapter` | No-op for projects with no managed dev server |
| `ConfigAdapter` | Generic adapter driven by `.claude-swarm.json` |
| `DevServerAdapter` | Abstract base class; extend to build custom adapters |

### Custom adapters

Implement the `AppAdapter` interface:

```typescript
interface AppAdapter {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  kill(): Promise<void>;
  isRunning(): Promise<boolean>;
  logFile(): string | null;
}
```

`logFile()` should return the absolute path to the log file for this adapter, or `null` if no log is available. The path is used by the "View logs" TUI feature.

## License

MIT
