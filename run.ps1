# cwd is the consumer project root, set by the caller

if ($env:SWARM_WINDOW -ne "true") {
    $env:SWARM_WINDOW = "true"
    $projectName = (Split-Path $PWD -Leaf)
    wt --window swarm new-tab --title "Swarm: $projectName" -d $PWD powershell -ExecutionPolicy Bypass -NoExit -File $PSCommandPath
    exit
}

$workspace = Get-Content pnpm-workspace.yaml -Raw -ErrorAction SilentlyContinue
$isLocalLink = $workspace -and ($workspace -match 'link:\.\./claude-swarm')

if (-not $isLocalLink) {
    $packageVersion = (Get-Content package.json | ConvertFrom-Json).devDependencies.'@annix/claude-swarm'
    $latestVersion = (npm view @annix/claude-swarm version 2>$null)

    if ($latestVersion -and ($latestVersion -ne $packageVersion)) {
        Write-Host "Updating @annix/claude-swarm: $packageVersion -> $latestVersion"
        $packageJson = Get-Content package.json -Raw | ConvertFrom-Json
        $packageJson.devDependencies.'@annix/claude-swarm' = $latestVersion
        $packageJson | ConvertTo-Json -Depth 100 | Set-Content package.json
    }
}

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
node node_modules\@annix\claude-swarm\dist\bin.js
