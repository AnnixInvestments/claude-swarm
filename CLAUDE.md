# Claude Code Preferences

## Code Style
- **No comments in code**: Use self-documenting method names instead of inline comments
- **Follow project lint/biome**: Obey existing Biome formatting (double quotes, 2-space indent per biome.json)
- **Minimal changes**: Keep patches targeted and scoped to request
- **Follow existing patterns**: Don't introduce new patterns without discussion
- **No imperative loops**: Replace `for`/`while` constructs with declarative array operations (`map`, `reduce`, `filter`, etc.)
- **Prefer const over let**: Always use `const` for variable declarations. Only use `let` when reassignment is genuinely unavoidable. Never use `var`.
- **Method naming**: Never prefix methods with "get" - type system conveys that
- **Use null instead of undefined**: Always use `null` for absence of value, never `undefined`

## Git Commits
- **No pull requests**: Commits directly to `main`
- **Ask before committing**: Propose message and wait for explicit approval
- **Semantic commit messages** with issue references
- **No AI attribution** in commit messages
- **Hook failures**: When a pre-push hook fails (e.g. lint error), fix the issue and amend the existing commit — do not create a new commit

## Architecture

### Core Features
- **Worktree isolation**: All parallel work uses git worktrees — never bare branches
- **Session management**: Spawn Claude Code sessions in isolated worktrees or on main
- **Dev server lifecycle**: Start/stop/restart configured dev apps with process management
- **Environment profiles**: Fetch secrets from providers (Fly.io) and inject into dev servers
- **Interactive menu**: TUI with keyboard shortcuts for all operations

### Worktree System
- All non-main work happens in worktrees, not bare branches
- Worktrees stored in `../{projectname}-worktrees/` (configurable)
- Each worktree has its own branch under `claude/*` prefix
- "Bring to main" cherry-picks commits from worktree onto main locally (no PRs, no push)
- "Approve" does rebase + fast-forward merge + cleanup
- Deleting a worktree cleans up both the directory and the branch

### Environment Profiles
- Profiles defined in `.claude-swarm/config.json` under `profiles`
- `claude-swarm env setup <profile>` fetches secrets from remote providers
- `claude-swarm env list` shows saved env configs
- `--profile <name>` flag or interactive menu selection injects env vars into spawned processes
- `envDir` in config specifies where `.env` files are saved (default: `.claude-swarm/envs`)
- Providers: `flyio` (fetches via `fly ssh console`)

### Key Files
- `src/index.ts` — Main orchestration (sessions, worktrees, menus, app lifecycle)
- `src/config.ts` — Config types and loading (SwarmConfig, ProfileConfig, EnvProviderConfig)
- `src/adapters/ConfigAdapter.ts` — Process lifecycle management with env override injection
- `src/env/env-provider.ts` — EnvProvider interface, env file parse/write/load
- `src/env/flyio-provider.ts` — Fly.io secret fetcher
- `run.sh` / `run.ps1` — Consumer entry points with auto-update and install checks
