$ErrorActionPreference = 'Continue'
while ($true) {
  & (Join-Path $PSScriptRoot 'start-background.ps1') -NoRegister
  Start-Sleep -Seconds 30
}
