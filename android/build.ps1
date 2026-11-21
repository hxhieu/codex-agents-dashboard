$ErrorActionPreference = 'Stop'

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Executable exited with code $LASTEXITCODE." }
}

function Get-Jar([string]$Path, [string]$Artifact, [string]$Hash) {
  if (!(Test-Path -LiteralPath $Path)) {
    Invoke-Checked 'curl.exe' @('--fail', '--silent', '--show-error', '--location', '--max-time', '60',
      '--output', $Path, "https://repo.maven.apache.org/maven2/$Artifact")
  }
  if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Hash) {
    throw "Checksum mismatch for $Path."
  }
}

$Sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
if (!$Sdk -or !$env:JAVA_HOME) { throw 'Set ANDROID_HOME and JAVA_HOME before building.' }
$Tools = Join-Path $Sdk 'build-tools\37.0.0'
$Platform = Join-Path $Sdk 'platforms\android-37.0\android.jar'
$Jdk = Join-Path $env:JAVA_HOME 'bin'
$Repo = Split-Path -Parent $PSScriptRoot
$Build = Join-Path $PSScriptRoot 'build'
$Sources = Join-Path $PSScriptRoot 'src\main'
$Assets = Join-Path $Build 'assets'
$Dependencies = Join-Path $Build 'dependencies'
$Signing = Join-Path $PSScriptRoot '.debug-signing'

foreach ($required in @($Platform, "$Tools\aapt2.exe", "$Jdk\javac.exe")) {
  if (!(Test-Path -LiteralPath $required)) { throw "Missing build tool or platform at $required." }
}

New-Item -Path $Build, $Assets, $Dependencies, $Signing -ItemType Directory -Force | Out-Null
$NanoHttpd = Join-Path $Dependencies 'nanohttpd-2.3.1.jar'
$Rhino = Join-Path $Dependencies 'rhino-1.8.1.jar'
Get-Jar $NanoHttpd 'org/nanohttpd/nanohttpd/2.3.1/nanohttpd-2.3.1.jar' 'DE864C47818157141A24C9ACB36DF0C47D7BF15B7FF48C90610F3EB4E5DF0E58'
Get-Jar $Rhino 'org/mozilla/rhino/1.8.1/rhino-1.8.1.jar' '98A06D42BDD69DA15BF9C2A7812B4CFE648CA9E64FE8BAAEB502A32B0ED2C8AC'

Push-Location -LiteralPath $Repo
try {
  Invoke-Checked 'pnpm' @('exec', 'astro', 'build', '--config', 'android/astro.config.mjs')
  Invoke-Checked 'node' @('android/build-normalizer.mjs')
} finally {
  Pop-Location
}

$Licenses = Join-Path $Assets 'licenses'
New-Item -Path $Licenses -ItemType Directory -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'rhino-license.txt') -Destination (Join-Path $Licenses 'rhino.txt')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'nanohttpd-license.txt') -Destination (Join-Path $Licenses 'nanohttpd.txt')
Set-Content -LiteralPath (Join-Path $Licenses 'rhino-source.txt') -Encoding UTF8 -Value 'https://github.com/mozilla/rhino/tree/Rhino1_8_1_Release'

$Classes = Join-Path $Build 'classes'
if (Test-Path -LiteralPath $Classes) {
  $Resolved = Get-Item -LiteralPath $Classes
  if ($Resolved.FullName -ne $Classes -or ($Resolved.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "Unexpected Android build directory $Resolved."
  }
  Remove-Item -LiteralPath $Resolved.FullName -Recurse -Force
}
New-Item -Path $Classes -ItemType Directory | Out-Null
$JavaFiles = @(Get-ChildItem -LiteralPath (Join-Path $Sources 'java') -Recurse -Filter '*.java' | Select-Object -ExpandProperty FullName)
$Classpath = @($Platform, $NanoHttpd, $Rhino) -join [IO.Path]::PathSeparator
$Resources = Join-Path $Build 'resources.zip'
$ClassJar = Join-Path $Build 'app-classes.jar'
Invoke-Checked "$Jdk\javac.exe" (@('--release', '11', '-encoding', 'UTF-8', '-classpath', $Classpath, '-d', $Classes) + $JavaFiles)
Invoke-Checked "$Jdk\jar.exe" @('cf', $ClassJar, '-C', $Classes, '.')
Invoke-Checked "$Tools\d8.bat" @('--lib', $Platform, '--min-api', '30', '--output', $Build, $ClassJar, $NanoHttpd, $Rhino)
Invoke-Checked "$Tools\aapt2.exe" @('compile', '--dir', "$Sources\res", '-o', $Resources)

$Unsigned = Join-Path $Build 'unsigned.apk'
$Aligned = Join-Path $Build 'aligned.apk'
$Apk = Join-Path $Build 'codex-agents-dashboard-debug.apk'
$Key = Join-Path $Signing 'debug.keystore'
Invoke-Checked "$Tools\aapt2.exe" @('link', '--debug-mode', '-I', $Platform, '--manifest', "$Sources\AndroidManifest.xml",
  '-o', $Unsigned, $Resources)
$Archive = [System.IO.Compression.ZipFile]::Open($Unsigned, [System.IO.Compression.ZipArchiveMode]::Update)
try {
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($Archive, (Join-Path $Build 'classes.dex'), 'classes.dex') | Out-Null
  foreach ($Asset in Get-ChildItem -LiteralPath $Assets -Recurse -File) {
    # AssetManager uses slash-delimited ZIP names on every platform.
    $Entry = 'assets/' + $Asset.FullName.Substring($Assets.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($Archive, $Asset.FullName, $Entry) | Out-Null
  }
} finally {
  $Archive.Dispose()
}
Invoke-Checked "$Tools\zipalign.exe" @('-f', '4', $Unsigned, $Aligned)

if (!(Test-Path -LiteralPath $Key)) {
  Invoke-Checked "$Jdk\keytool.exe" @('-genkeypair', '-keystore', $Key, '-storepass', 'android', '-keypass', 'android',
    '-alias', 'androiddebugkey', '-dname', 'CN=Android Debug', '-keyalg', 'RSA', '-validity', '10000', '-noprompt')
}
Invoke-Checked "$Tools\apksigner.bat" @('sign', '--ks', $Key, '--ks-pass', 'pass:android', '--out', $Apk, $Aligned)
Invoke-Checked "$Tools\apksigner.bat" @('verify', $Apk)
Write-Output $Apk
