param([switch]$NoRegister)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataPath = Join-Path $projectRoot 'data'
New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
$statePath = Join-Path $dataPath 'background.json'
if (Test-Path -LiteralPath $statePath) {
  $existing = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  $running = Get-CimInstance Win32_Process -Filter "ProcessId = $($existing.pid)" -ErrorAction SilentlyContinue
  if ($running -and $running.CommandLine -like "*$projectRoot*src*server.ts*") {
    Write-Output "Solo Agentic already running (PID $($existing.pid))."
    exit 0
  }
}
$nodePath = (Get-Command node.exe).Source
$serverPath = Join-Path $projectRoot 'src\server.ts'
$launchArgs = "--import tsx `"$serverPath`""
$process = Start-Process -FilePath $nodePath -ArgumentList $launchArgs -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataPath 'service.log') -RedirectStandardError (Join-Path $dataPath 'service-error.log') -PassThru
@{ pid = $process.Id; root = $projectRoot; startedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $statePath
Write-Output "Solo Agentic started in background (PID $($process.Id)). Dashboard: http://127.0.0.1:4310"
if (-not $NoRegister) {
  try {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'watch-background.ps1')`"" -WorkingDirectory $projectRoot
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName 'Solo Agentic Background' -Action $action -Trigger $trigger -Settings $settings -Description 'Persistent Solo Agentic supervisor; restarts after failure and at user logon.' -User "$env:USERDOMAIN\$env:USERNAME" -RunLevel Limited -Force | Out-Null
    Start-ScheduledTask -TaskName 'Solo Agentic Background'
    Write-Output 'User-logon recovery and persistent watchdog registered.'
  } catch {
    Write-Output "Background process is running; startup registration unavailable: $($_.Exception.Message). Use Docker on an always-on host for continuous uptime."
  }
}
