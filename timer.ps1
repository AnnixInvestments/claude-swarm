# Per-step timing utility for pre-push hooks (PowerShell).
# Dot-source this file, wrap each step with Invoke-TimedStep,
# then call Write-TimingSummary.
#
# Usage:
#   . "$PSScriptRoot\..\node_modules\@annix\claude-swarm\timer.ps1"
#
#   Invoke-TimedStep "step name" { some-command --args }
#   Invoke-TimedStep "other step" { another-command }
#
#   Write-TimingSummary

$script:TimedSteps = [System.Collections.Generic.List[hashtable]]::new()

function Invoke-TimedStep {
  param(
    [string]$Name,
    [scriptblock]$Action
  )

  Write-Host ""
  Write-Host ">> ${Name}..."

  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $success = $true

  try {
    & $Action
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {
      $success = $false
    }
  } catch {
    $success = $false
  }

  $watch.Stop()
  $elapsed = [int]$watch.Elapsed.TotalSeconds

  $script:TimedSteps.Add(@{ Name = $Name; Seconds = $elapsed; Status = if ($success) { "ok" } else { "failed" } })

  if (-not $success) {
    Write-TimingSummary
    exit 1
  }
}

function Write-TimingSummary {
  $maxSecs = ($script:TimedSteps | Measure-Object -Property Seconds -Maximum).Maximum
  $total = ($script:TimedSteps | Measure-Object -Property Seconds -Sum).Sum
  $sep = "--------------------------------------------"

  Write-Host ""
  Write-Host "Pre-push step timings"
  Write-Host $sep

  foreach ($step in $script:TimedSteps) {
    $mins = [int][Math]::Floor($step.Seconds / 60)
    $secs = $step.Seconds % 60
    $suffix = ""
    if ($step.Status -eq "failed") {
      $suffix = "  <- FAILED"
    } elseif ($step.Seconds -eq $maxSecs -and $script:TimedSteps.Count -gt 1) {
      $suffix = "  <- slowest"
    }
    Write-Host ("  {0,-32} {1}m {2:D2}s{3}" -f $step.Name, $mins, $secs, $suffix)
  }

  Write-Host $sep
  $totalMins = [int][Math]::Floor($total / 60)
  $totalSecs = $total % 60
  Write-Host ("  {0,-32} {1}m {2:D2}s" -f "TOTAL", $totalMins, $totalSecs)
  Write-Host ""
}
