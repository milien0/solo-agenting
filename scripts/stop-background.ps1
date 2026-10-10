$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$dataPath = Join-Path $projectRoot 'data'
$statePath = Join-Path $dataPath 'background.json'
$task = Get-ScheduledTask -TaskName 'Solo Agentic Background' -ErrorAction SilentlyContinue
if ($task) { Stop-ScheduledTask -TaskName 'Solo Agentic Background'; Disable-ScheduledTask -TaskName 'Solo Agentic Background' | Out-Null }
if (Test-Path -LiteralPath $statePath) {
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.pid)" -ErrorAction SilentlyContinue
  if ($process -and $process.CommandLine -like "*$projectRoot*src*server.ts*") {
    # Confirm process identity before terminating this process tree.
    taskkill.exe /PID $state.pid /T /F | Out-Null
    Write-Output 'Solo Agentic background process stopped. Durable state retained.'
  }
}
