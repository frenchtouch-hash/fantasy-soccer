$ErrorActionPreference = 'Stop'

$taskName = 'FIFA Fantasy GitHub Pages Publish'
$publishScript = Join-Path $PSScriptRoot 'publish-github-pages.ps1'
$startTime = (Get-Date).AddMinutes(5).ToString('HH:mm')
$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$publishScript`""

schtasks /Create `
  /TN $taskName `
  /TR $taskCommand `
  /SC HOURLY `
  /MO 3 `
  /ST $startTime `
  /F | Out-Null

Write-Host "Installed scheduled task: $taskName"
Write-Host "Runs every 3 hours starting at $startTime."
