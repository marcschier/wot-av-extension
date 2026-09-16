[CmdletBinding()]
param(
    [switch]$AllowNative,
    [Parameter(Mandatory)][string]$SdkRoot,
    [Parameter(Mandatory)][string]$SourceRoot,
    [Parameter(Mandatory)][string]$SdkArchive,
    [Parameter(Mandatory)][string]$NodeExecutable,
    [string]$BuildRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'native-media\native-paths.ps1')
if (-not $AllowNative) {
    throw 'Native fixture execution requires explicit local SDK/license permission (-AllowNative); no download is performed.'
}
$root = $NativeRepoRoot
if (-not $BuildRoot) {
    $BuildRoot = Join-Path $NativeProjectRoot 'build-package-ci'
}
$BuildRoot = [IO.Path]::GetFullPath($BuildRoot)
foreach ($path in @($SdkRoot, $SourceRoot, $SdkArchive, $NodeExecutable)) {
    if (-not [IO.Path]::IsPathFullyQualified($path) -or -not (Test-Path -LiteralPath $path)) {
        throw 'Native SDK, pristine source, cached archive and Node inputs must be existing absolute operator-provisioned paths.'
    }
}
$lock = Get-Content -LiteralPath (Join-Path $NativeProjectRoot 'dependencies.lock.json') -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $SdkArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $lock.gstreamer.installer.sha256) {
    throw 'Cached official SDK archive hash does not match the native lock; no native code was executed.'
}
$env:PATH = (Split-Path -Parent $NodeExecutable) + ';' + $env:PATH
Remove-Item Env:NODE_PATH, Env:NODE_OPTIONS -ErrorAction SilentlyContinue
Push-Location $root
try {
    & (Join-Path $NativeToolRoot 'build.ps1') -SdkRoot $SdkRoot -SourceRoot $SourceRoot `
        -BuildRoot $BuildRoot -NodeExecutable $NodeExecutable
    & python -B (Join-Path $NativeTestRoot 'cohort_gate.py') `
        --build-root $BuildRoot --sdk-root $SdkRoot --sdk-archive $SdkArchive
    if ($LASTEXITCODE -ne 0) { throw "Native complete cohort failed with exit $LASTEXITCODE." }
    $env:ONVIF_MEDIA_NATIVE_TEST = '1'
    $env:ONVIF_MEDIA_WORKER = Join-Path $BuildRoot 'bin\onvif_media_worker.exe'
    $env:ONVIF_MEDIA_SDK_ROOT = $SdkRoot
    $env:ONVIF_MEDIA_PYTHON = (Get-Command python -ErrorAction Stop).Source
    & npm run test:onvif:media:native
    if ($LASTEXITCODE -ne 0) { throw "Node/native integration failed with exit $LASTEXITCODE." }
} finally {
    Pop-Location
}
