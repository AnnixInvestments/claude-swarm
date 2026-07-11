# cwd is the consumer project root, set by the caller

if ($env:SWARM_WINDOW -ne "true") {
    $env:SWARM_WINDOW = "true"
    $projectName = (Split-Path $PWD -Leaf)
    wt --window swarm new-tab --title "Swarm: $projectName" -d $PWD powershell -ExecutionPolicy Bypass -NoExit -File $PSCommandPath @args
    exit
}

$ClaudeCodePackage = "@anthropic-ai/claude-code"
$UpdateCacheFile = Join-Path $HOME ".claude/swarm-update-check"

function Write-UpdateStamp {
    $dir = Split-Path $UpdateCacheFile -Parent
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $stamp = [int64]([DateTimeOffset]::Now.ToUnixTimeSeconds())
    $stamp | Out-File -FilePath $UpdateCacheFile -Encoding ascii -NoNewline
}

function Test-UpdateCacheFresh {
    if (-not (Test-Path $UpdateCacheFile)) { return $false }
    $raw = (Get-Content $UpdateCacheFile -Raw -ErrorAction SilentlyContinue)
    if (-not $raw) { return $false }
    $last = 0
    if (-not [int64]::TryParse($raw.Trim(), [ref]$last)) { return $false }
    $now = [int64]([DateTimeOffset]::Now.ToUnixTimeSeconds())
    return ($now - $last) -lt 86400
}

function Get-LocalClaudeVersion {
    try {
        $output = (& claude --version 2>$null) -join "`n"
        if ($output -match '(\d+\.\d+\.\d+)') {
            return $matches[1]
        }
    } catch {}
    return $null
}

function Get-RemoteClaudeVersion {
    try {
        $resp = Invoke-WebRequest `
            -Uri "https://registry.npmjs.org/$ClaudeCodePackage/latest" `
            -TimeoutSec 5 `
            -UseBasicParsing `
            -ErrorAction Stop
        return (ConvertFrom-Json $resp.Content).version
    } catch {
        return $null
    }
}

function Resolve-NpmCommand {
    $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $cmd) { $cmd = Get-Command npm -ErrorAction SilentlyContinue }
    if ($cmd) { return $cmd.Source }
    return "npm.cmd"
}

function Invoke-ClaudeCodeUpdateCheck {
    param([string[]]$ScriptArgs)

    if ($env:CLAUDE_SWARM_NO_UPDATE_CHECK -eq "1") { return }

    $force = $false
    if ($ScriptArgs) { $force = $ScriptArgs -contains "--check-updates" }

    if (-not $force -and (Test-UpdateCacheFresh)) { return }

    $local = Get-LocalClaudeVersion
    $remote = Get-RemoteClaudeVersion
    if (-not $local -or -not $remote) { return }

    if ($local -eq $remote) {
        Write-UpdateStamp
        return
    }

    $localMinor = ($local -split '\.')[0..1] -join '.'
    $remoteMinor = ($remote -split '\.')[0..1] -join '.'

    if ($localMinor -eq $remoteMinor) {
        Write-Host "Auto-updating Claude Code (patch): $local -> $remote"
        $proc = Start-Process -FilePath (Resolve-NpmCommand) -ArgumentList "i", "-g", $ClaudeCodePackage `
            -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput ([System.IO.Path]::GetTempFileName()) `
            -RedirectStandardError ([System.IO.Path]::GetTempFileName())
        if ($proc.ExitCode -eq 0) {
            Write-UpdateStamp
        }
    } else {
        Write-Host ""
        Write-Host "Claude Code update available: $local -> $remote (minor/major)"
        Write-Host "  npm i -g $ClaudeCodePackage"
        Write-Host ""
    }
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

Invoke-ClaudeCodeUpdateCheck -ScriptArgs $args

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
node node_modules\@annix\claude-swarm\dist\bin.js @args
