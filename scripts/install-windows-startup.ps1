[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateNotNullOrEmpty()]
  [string]$TaskName = 'Codex Agents Dashboard',
  [System.Net.IPAddress]$ListenAddress = '0.0.0.0',
  [ValidateRange(1, 65535)]
  [int]$Port = 4321,
  [string]$NodePath = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source,
  [string]$CodexPath = $env:CODEX_BIN
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runnerPath = Join-Path $PSScriptRoot 'start-dashboard.ps1'
$description = 'Starts the production Codex Agents Dashboard at sign-in.'

if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'dist/server/entry.mjs') -PathType Leaf)) {
  throw 'Production build is missing. Run pnpm build first.'
}

# Resolve the nvm symlink now: future nvm use commands must not change this task.
$nodeDetails = & $NodePath -p "JSON.stringify({path:require('node:fs').realpathSync(process.execPath),version:process.versions.node})"
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the Node executable.' }
$nodeDetails = $nodeDetails | ConvertFrom-Json
$expectedVersion = (Get-Content -LiteralPath (Join-Path $projectRoot '.nvmrc') -Raw).Trim()
if ($nodeDetails.version -ne $expectedVersion) {
  throw "Use nvm use $expectedVersion before installing the startup task."
}
$NodePath = $nodeDetails.path

if (!$CodexPath) {
  $codexCommand = Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue
  if ($codexCommand) { $CodexPath = $codexCommand.Source }
}
if ($CodexPath) { $CodexPath = (Resolve-Path -LiteralPath $CodexPath -ErrorAction Stop).Path }

$existing = Get-ScheduledTask -TaskName $TaskName -TaskPath '\' -ErrorAction SilentlyContinue
if ($existing -and $existing.Description -ne $description) {
  throw "A different task named '$TaskName' already exists. Choose another -TaskName."
}

$taskArguments = @(
  '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
  '-ExecutionPolicy', 'Bypass', '-File', "`"$runnerPath`"",
  '-NodePath', "`"$NodePath`"", '-ListenAddress', $ListenAddress.ToString(),
  '-Port', $Port.ToString()
)
if ($CodexPath) { $taskArguments += @('-CodexPath', "`"$CodexPath`"") }

$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAction = New-ScheduledTaskAction `
  -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -Argument ($taskArguments -join ' ') -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
# Legacy fallback during migration to node-windows. Do not install new tasks.
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

if ($PSCmdlet.ShouldProcess($TaskName, 'Register sign-in startup task')) {
  Register-ScheduledTask -TaskName $TaskName -TaskPath '\' -Action $taskAction `
    -Trigger $trigger -Principal $principal -Settings $settings `
    -Description $description -Force | Out-Null
  Write-Output "Installed '$TaskName' for $account. It will start hidden at your next sign-in."
  Write-Output "Node: $NodePath"
  Write-Output "Address: http://localhost:$Port"
  Write-Output "To start now, first stop any server using port $Port, then run:"
  Write-Output "Start-ScheduledTask -TaskName '$($TaskName.Replace("'", "''"))'"
}
