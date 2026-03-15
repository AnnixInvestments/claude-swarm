#!/usr/bin/env bash
# cwd is the consumer project root, set by the caller

HASH_FILE="node_modules/.install-hash"

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

if needs_install; then
  pnpm install
  compute_hash > "$HASH_FILE"
fi
pnpm claude-swarm
