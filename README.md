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

## Installation

```sh
npm install -g claude-swarm
# or
pnpm add -g claude-swarm
```

## Usage

Run from any git repository:

```sh
claude-swarm
```

The tool will detect the current project and load configuration from `.claude-swarm.json` if present.

## Configuration

Create a `.claude-swarm.json` in your project root:

```json
{
  "branchPrefix": "claude/",
  "apps": [
    {
      "name": "backend",
      "start": "pnpm --filter backend dev",
      "stop": "signal:SIGTERM",
      "kill": "signal:SIGKILL",
      "readyPattern": "Nest application successfully started"
    },
    {
      "name": "frontend",
      "start": "pnpm --filter frontend dev",
      "stop": "signal:SIGTERM",
      "kill": "signal:SIGKILL",
      "readyPattern": "Local:.*http"
    }
  ]
}
```

### Configuration options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `branchPrefix` | `string` | `"claude/"` | Prefix for Claude-managed branches |
| `apps` | `AppAdapterConfig[]` | `[]` | Dev server definitions |

### App adapter config

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Display name |
| `start` | `string` | Yes | Command to start the server |
| `stop` | `string` | Yes | Command or signal to stop gracefully (e.g. `signal:SIGTERM`) |
| `kill` | `string` | Yes | Command or signal to force-stop (e.g. `signal:SIGKILL`) |
| `readyPattern` | `string` | No | Regex pattern to detect when the server is ready |

## App Adapter Interface

You can use the built-in adapters programmatically:

```typescript
import {
  AppAdapter,
  NestAdapter,
  NextAdapter,
  ViteAdapter,
  NullAdapter,
  ConfigAdapter,
} from "claude-swarm";
```

### Built-in adapters

- `NestAdapter` - NestJS backend (`nest start --watch`)
- `NextAdapter` - Next.js frontend (`next dev`)
- `ViteAdapter` - Vite dev server (`vite`)
- `NullAdapter` - No-op for projects with no managed dev server
- `ConfigAdapter` - Generic adapter driven by JSON config

### Custom adapters

Implement the `AppAdapter` interface:

```typescript
interface AppAdapter {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  kill(): Promise<void>;
  isRunning(): Promise<boolean>;
}
```

## Multi-project support

claude-swarm supports managing sessions across multiple projects. The first time you start a session,
you can add new projects interactively. Project configurations are saved to `.parallel-claude-projects.json`
in the directory where you run `claude-swarm`.

## Branch workflow

By default, Claude sessions work on branches with the `claude/` prefix. The tool provides:

- **Branch listing** - see all claude branches with ahead/behind status
- **Rebase** - rebase a claude branch onto main
- **Approve** - rebase + fast-forward merge + delete in one step
- **Cherry-pick** - pull specific commits from a claude branch for testing

## License

MIT
