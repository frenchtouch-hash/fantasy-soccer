$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$remote = git remote get-url origin 2>$null
if (-not $remote) {
  throw "No git remote named 'origin' is configured. Add your GitHub repo remote before publishing."
}

npm run pages:refresh

git add docs/index.html docs/.nojekyll

$status = git status --short -- docs
if (-not $status) {
  Write-Host "No GitHub Pages changes to publish."
  exit 0
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
git commit -m "Publish live dashboard $timestamp"
git push origin master

Write-Host "Published updated GitHub Pages content to origin/master."
