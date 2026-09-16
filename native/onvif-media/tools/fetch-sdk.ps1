[CmdletBinding()]
param(
    [switch]$AcceptUpstreamLicenses,
    [switch]$ProvisionPortable,
    [string]$TaskRoot = (Join-Path $env:TEMP 'acf-media-research\onvif-native-p0-64c41574'),
    [string]$CachedArchive
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $AcceptUpstreamLicenses) {
    throw 'Read dependencies.lock.json noticeUrl and licensingAdvisory, then explicitly pass -AcceptUpstreamLicenses. No download performed.'
}
if (-not [Environment]::Is64BitOperatingSystem -or $env:OS -ne 'Windows_NT') {
    throw 'This qualification SDK is Windows x64 only.'
}

$allowedParent = [IO.Path]::GetFullPath((Join-Path $env:TEMP 'acf-media-research'))
$TaskRoot = [IO.Path]::GetFullPath($TaskRoot)
if (-not $TaskRoot.StartsWith("$allowedParent\", [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($TaskRoot) -notlike 'onvif-native-p0-*') {
    throw "TaskRoot must be a named onvif-native-p0-* child under $allowedParent."
}
$manifest = Get-Content (Join-Path $PSScriptRoot '..\dependencies.lock.json') -Raw | ConvertFrom-Json
$package = $manifest.gstreamer.installer
$marker = Join-Path $TaskRoot '.onvif-native-p0'
if ((Test-Path $TaskRoot) -and -not (Test-Path $marker)) {
    throw 'Refusing to use an existing directory without this gate ownership marker.'
}
New-Item -ItemType Directory -Path $TaskRoot -Force | Out-Null
if (-not (Test-Path $marker)) {
    'Task-local GStreamer qualification dependencies; not a system installation.' |
        Set-Content $marker -Encoding ascii
}

$archive = if ($CachedArchive) { [IO.Path]::GetFullPath($CachedArchive) } else { Join-Path $TaskRoot $package.file }
if ($CachedArchive -and -not (Test-Path $archive -PathType Leaf)) {
    throw 'The explicitly selected cached SDK archive is missing.'
}
if (-not (Test-Path $archive)) {
    $partial = "$archive.partial"
    Invoke-WebRequest -Uri $package.url -OutFile $partial -MaximumRedirection 0
    $actual = (Get-FileHash $partial -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $package.sha256) {
        throw "SDK checksum mismatch: expected $($package.sha256), received $actual. The partial file was not executed."
    }
    Move-Item -LiteralPath $partial -Destination $archive
}
$actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $package.sha256) {
    throw 'Existing SDK download failed its locked SHA-256; nothing was executed.'
}
$signature = Get-AuthenticodeSignature -LiteralPath $archive
Write-Output "Verified official SDK SHA-256: $actual"
Write-Output "Authenticode status: $($signature.Status)"

if ($ProvisionPortable) {
    $sdk = Join-Path $TaskRoot 'sdk'
    if (Test-Path $sdk) {
        throw "SDK destination already exists. Inspect it explicitly instead of overlaying an installation: $sdk"
    }
    $log = Join-Path $TaskRoot 'portable-sdk.log'
    $arguments = @(
        '/portable=1', '/CURRENTUSER', '/TYPE=devel', '/TASKS=',
        '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOICONS',
        "/DIR=`"$sdk`"", "/LOG=`"$log`""
    )
    $process = Start-Process -FilePath $archive -ArgumentList $arguments -PassThru -Wait
    if ($process.ExitCode -ne 0) {
        throw "Portable SDK extraction failed with exit $($process.ExitCode); inspect $log."
    }
    if (-not (Select-String -LiteralPath $log -SimpleMatch 'Portable mode detected' -Quiet)) {
        throw "The installer did not confirm portable mode; inspect $log before proceeding."
    }
    foreach ($relative in @('bin\gst-inspect-1.0.exe', 'include\gstreamer-1.0\gst\gst.h')) {
        if (-not (Test-Path (Join-Path $sdk $relative))) {
            throw "Portable SDK is incomplete: missing $relative."
        }
    }
    Write-Output "Portable SDK: $sdk"
    Write-Output "Extraction evidence: $log"
}
