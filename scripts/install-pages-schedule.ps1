$ErrorActionPreference = 'Stop'

$taskName = 'FIFA Fantasy GitHub Pages Publish'
$publishScript = Join-Path $PSScriptRoot 'publish-github-pages.ps1'

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$publishScript`""

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(5)
$trigger.RepetitionInterval = 'PT3H'
$trigger.RepetitionDuration = 'P365D'

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description 'Refresh FIFA dashboard locally and push docs/ to GitHub Pages every 3 hours.' `
  -Force | Out-Null

Write-Host "Installed scheduled task: $taskName"
