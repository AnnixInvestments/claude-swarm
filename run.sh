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

if needs_install; then
  pnpm install
  compute_hash > "$HASH_FILE"
fi
pnpm claude-swarm
