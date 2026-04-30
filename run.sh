#!/usr/bin/env bash
# cwd is the consumer project root, set by the caller

HASH_FILE="node_modules/.install-hash"
CLAUDE_CODE_PKG="@anthropic-ai/claude-code"
UPDATE_CACHE="$HOME/.claude/swarm-update-check"

run_with_timeout() {
  local secs=$1
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
  else
    "$@"
  fi
}

write_update_stamp() {
  mkdir -p "$(dirname "$UPDATE_CACHE")" 2>/dev/null || return
  date +%s > "$UPDATE_CACHE" 2>/dev/null || true
}

update_cache_fresh() {
  [ -f "$UPDATE_CACHE" ] || return 1
  local last
  last=$(cat "$UPDATE_CACHE" 2>/dev/null)
  [ -n "$last" ] || return 1
  local now
  now=$(date +%s)
  [ $((now - last)) -lt 86400 ]
}

check_claude_code() {
  [ "$CLAUDE_SWARM_NO_UPDATE_CHECK" = "1" ] && return 0

  local force=0
  for arg in "$@"; do
    [ "$arg" = "--check-updates" ] && force=1
  done

  if [ "$force" -ne 1 ] && update_cache_fresh; then
    return 0
  fi

  local local_v
  local_v=$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  local remote_v
  remote_v=$(run_with_timeout 5 npm view "$CLAUDE_CODE_PKG" version 2>/dev/null)

  if [ -z "$local_v" ] || [ -z "$remote_v" ]; then
    return 0
  fi

  if [ "$local_v" = "$remote_v" ]; then
    write_update_stamp
    return 0
  fi

  local local_minor remote_minor
  local_minor=$(echo "$local_v" | cut -d. -f1-2)
  remote_minor=$(echo "$remote_v" | cut -d. -f1-2)

  if [ "$local_minor" = "$remote_minor" ]; then
    echo "Auto-updating Claude Code (patch): $local_v -> $remote_v"
    if npm i -g "$CLAUDE_CODE_PKG" >/dev/null 2>&1; then
      write_update_stamp
    fi
  else
    echo ""
    echo "Claude Code update available: $local_v -> $remote_v (minor/major)"
    echo "  npm i -g $CLAUDE_CODE_PKG"
    echo ""
  fi
}

compute_hash() {
  node -e "
    const {createHash} = require('crypto');
    const {readFileSync} = require('fs');
    const h = createHash('sha256');
    for (const f of ['package.json', 'pnpm-lock.yaml']) {
      try { h.update(readFileSync(f)); } catch {}
    }
    console.log(h.digest('hex'));
  "
}

needs_install() {
  [ ! -f "node_modules/@annix/claude-swarm/run.sh" ] && return 0
  [ ! -f "$HASH_FILE" ] && return 0
  [ "$(compute_hash)" != "$(cat "$HASH_FILE")" ] && return 0
  return 1
}

auto_update() {
  local specifier
  specifier=$(node -p "require('./package.json').devDependencies['@annix/claude-swarm']" 2>/dev/null)

  # Skip auto-update for local file: references
  [[ "$specifier" == file:* ]] && return

  local latest
  latest=$(npm view @annix/claude-swarm version 2>/dev/null)
  [ -z "$latest" ] && return

  if [ "$latest" != "$specifier" ]; then
    echo "Updating @annix/claude-swarm: $specifier -> $latest"
    node -e "
      const pkg = require('./package.json');
      pkg.devDependencies['@annix/claude-swarm'] = '$latest';
      require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
    "
    pnpm install
    compute_hash > "$HASH_FILE"
  fi
}

auto_update
check_claude_code "$@"

if needs_install; then
  pnpm install
  compute_hash > "$HASH_FILE"
fi
pnpm claude-swarm "$@"
