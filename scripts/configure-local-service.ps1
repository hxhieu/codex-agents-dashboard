[CmdletBinding(SupportsShouldProcess = $true)]
param([string]$ProjectRoot)

$ErrorActionPreference = 'Stop'
# Resolve ACL commands from this host, even when invoked from PowerShell 7.
# Load before changing service state or permissions so failures are immediate.
Import-Module ([IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Security', 'Microsoft.PowerShell.Security.psd1')) -ErrorAction Stop
if (!$ProjectRoot) { $ProjectRoot = Split-Path -Parent $PSScriptRoot }
$serviceName = 'codexagentsdashboard.exe'
$projectPath = (Resolve-Path -LiteralPath $ProjectRoot).Path
$statePath = Join-Path $projectPath '.windows-service'
$configPath = Join-Path $statePath 'config.json'
$xmlPath = Join-Path $statePath 'daemon/codexagentsdashboard.xml'
$logsPath = Join-Path $statePath 'logs'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
[xml]$definition = Get-Content -LiteralPath $xmlPath -Raw
$localService = [Security.Principal.SecurityIdentifier]::new('S-1-5-19')

# Grant access to public runtime code, never to the user's profile or Codex home.
$readFolders = @(
  (Join-Path $projectPath 'dist'),
  (Join-Path $projectPath 'node_modules'),
  (Join-Path $statePath 'daemon')
)
$readFiles = @($config.nodePath, (Join-Path $projectPath 'scripts/service-entry.mjs'))
foreach ($target in ($readFolders + $readFiles)) {
  if (!(Test-Path -LiteralPath $target)) { throw "Runtime file or folder is missing: $target" }
}
if (!$PSCmdlet.ShouldProcess($serviceName, 'Configure password-free LocalService account and runtime permissions')) { return }
if (!([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this setup from an administrator terminal.'
}

function Grant-RuntimeAccess([string]$Path, [Security.AccessControl.FileSystemRights]$Rights, [bool]$Inherit) {
  $acl = Get-Acl -LiteralPath $Path
  $flags = if ($Inherit) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
  $rule = [Security.AccessControl.FileSystemAccessRule]::new($localService, $Rights, $flags,
    [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
  $acl.SetAccessRule($rule)
  Set-Acl -LiteralPath $Path -AclObject $acl
}

$service = Get-Service -Name $serviceName
if ($service.Status -ne 'Stopped') {
  Stop-Service -InputObject $service
  $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
}
[IO.Directory]::CreateDirectory($logsPath) | Out-Null
foreach ($folder in @($projectPath, (Join-Path $projectPath 'scripts'), $statePath)) {
  Grant-RuntimeAccess $folder 'ReadAndExecute' $false
}
foreach ($folder in $readFolders) { Grant-RuntimeAccess $folder 'ReadAndExecute' $true }
foreach ($file in $readFiles) { Grant-RuntimeAccess $file 'ReadAndExecute' $false }
Grant-RuntimeAccess $logsPath 'Modify' $true

foreach ($entry in @($definition.service.SelectNodes("env[@name='CODEX_HOME' or @name='CODEX_BIN' or @name='DASHBOARD_CODEX_USAGE_DISABLED']"))) {
  $definition.service.RemoveChild($entry) | Out-Null
}
$disabled = $definition.CreateElement('env')
$disabled.SetAttribute('name', 'DASHBOARD_CODEX_USAGE_DISABLED')
$disabled.SetAttribute('value', '1')
$definition.service.AppendChild($disabled) | Out-Null
$logpath = $definition.service.SelectSingleNode('logpath')
if (!$logpath) { $logpath = $definition.CreateElement('logpath'); $definition.service.AppendChild($logpath) | Out-Null }
$logpath.InnerText = $logsPath
$definition.service.serviceaccount.domain = 'NT AUTHORITY'
$definition.service.serviceaccount.user = 'LocalService'
$definition.service.serviceaccount.password = ''
$definition.Save($xmlPath)

$result = Invoke-CimMethod -InputObject (Get-CimInstance Win32_Service -Filter "Name='$serviceName'") `
  -MethodName Change -Arguments @{ StartName = 'NT AUTHORITY\LocalService'; StartPassword = '' }
if ($result.ReturnValue -ne 0) { throw "Windows could not change the service account (code $($result.ReturnValue))." }
$config | Add-Member -NotePropertyName account -NotePropertyValue 'local-service' -Force
$config.PSObject.Properties.Remove('codexHome')
$config.PSObject.Properties.Remove('codexBin')
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Write-Output 'Configured NT AUTHORITY\LocalService without a password. Weekly Codex quota is disabled for this account.'
