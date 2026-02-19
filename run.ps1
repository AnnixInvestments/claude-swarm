# cwd is the consumer project root, set by the caller

$hashFile = "node_modules\.install-hash"

function Compute-Hash {
  node -e @"
const {createHash} = require('crypto');
const {readFileSync} = require('fs');
const h = createHash('sha256');
for (const f of ['package.json', 'pnpm-lock.yaml']) {
  try { h.update(readFileSync(f)); } catch {}
}
console.log(h.digest('hex'));
"@
}

$needsInstall = (
  -not (Test-Path "node_modules\@annix\claude-swarm\run.ps1") -or
  -not (Test-Path $hashFile) -or
  (Compute-Hash) -ne (Get-Content $hashFile -Raw).Trim()
)

if ($needsInstall) {
  pnpm install
  Compute-Hash | Out-File -FilePath $hashFile -NoNewline -Encoding utf8
}
pnpm claude-swarm
