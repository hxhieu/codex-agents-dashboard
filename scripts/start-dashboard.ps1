[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$NodePath,
  [System.Net.IPAddress]$ListenAddress = '0.0.0.0',
  [ValidateRange(1, 65535)]
  [int]$Port = 4321,
  [string]$CodexPath
)

$ErrorActionPreference = 'Stop'

try {
  $projectRoot = Split-Path -Parent $PSScriptRoot
  $entryPath = Join-Path $projectRoot 'dist/server/entry.mjs'
  if (!(Test-Path -LiteralPath $entryPath -PathType Leaf)) {
    throw 'Production build is missing. Run pnpm build first.'
  }
  if (!(Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw 'The registered Node executable is missing. Reinstall the startup task.'
  }

  Set-Location -LiteralPath $projectRoot
  $env:HOST = $ListenAddress.ToString()
  $env:PORT = $Port.ToString()
  $env:PATH = "$(Split-Path -Parent $NodePath);$env:PATH"
  if ($CodexPath) { $env:CODEX_BIN = $CodexPath }

  # Keep the task running for the lifetime of Node and propagate failures so
  # Task Scheduler can restart it. Do not detach the child with Start-Process.
  & $NodePath --import './scripts/watch-task-parent.mjs' $entryPath
  exit $LASTEXITCODE
} catch {
  Write-Error $_ -ErrorAction Continue
  exit 1
}
