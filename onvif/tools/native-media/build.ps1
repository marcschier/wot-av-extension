[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$SdkRoot,
    [Parameter(Mandatory)][string]$SourceRoot,
    [string]$BuildRoot,
    [string]$NodeExecutable,
    [switch]$Test
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'native-paths.ps1')
$project = $NativeProjectRoot
if (-not $BuildRoot) {
    $BuildRoot = Join-Path $project 'build-p0'
}
$BuildRoot = [IO.Path]::GetFullPath($BuildRoot)
if (-not $BuildRoot.StartsWith("$project\", [StringComparison]::OrdinalIgnoreCase)) {
    throw 'BuildRoot must be below the owned onvif\samples\reference-runtime\native-media directory.'
}
$cmake = (Get-Command cmake -ErrorAction Stop).Source
$ctest = (Get-Command ctest -ErrorAction Stop).Source
Get-Command ninja, python -ErrorAction Stop | Out-Null
$installer = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer'
$vswhere = Join-Path $installer 'vswhere.exe'
if (-not (Test-Path $vswhere)) {
    throw 'Missing Visual Studio discovery tool. No compiler or system installer is invoked automatically.'
}
$visualStudio = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $visualStudio) {
    throw 'Missing MSVC x64 C++ tools component: native qualification is blocked. Do not start a full GStreamer rebuild.'
}
$environment = Join-Path $visualStudio 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $environment)) {
    throw "Missing compiler environment script: $environment"
}
if (-not $NodeExecutable) {
    $node = Get-Command node -ErrorAction SilentlyContinue
    $bundledNode = Join-Path $visualStudio 'MSBuild\Microsoft\VisualStudio\NodeJs\node.exe'
    if ($node) {
        $NodeExecutable = $node.Source
    } elseif (Test-Path $bundledNode) {
        $NodeExecutable = $bundledNode
    } elseif ($Test) {
        throw 'Node >=22 is required for the explicit IPC smoke tests. Supply -NodeExecutable; no Node installation is performed.'
    } else {
        $NodeExecutable = 'node'
    }
}
foreach ($value in @($project, $BuildRoot, $SdkRoot, $SourceRoot, $NodeExecutable, $environment, $cmake, $installer)) {
    if ($value -match '["%\r\n]') {
        throw 'Unsupported command-shell metacharacter in a build path.'
    }
}
$command = 'set "PATH={0};%PATH%" && call "{1}" >nul && "{2}" -S "{3}" -B "{4}" -G Ninja -DCMAKE_BUILD_TYPE=Release "-DP0_GSTREAMER_ROOT={5}" "-DP0_UPSTREAM_ROOT={6}" "-DP0_NODE_EXECUTABLE={7}" && "{2}" --build "{4}" --parallel 2' -f `
    $installer, $environment, $cmake, $project, $BuildRoot, $SdkRoot, $SourceRoot, $NodeExecutable
& $env:ComSpec /d /s /c $command
if ($LASTEXITCODE -ne 0) {
    throw "Native P0 configure/build failed with exit $LASTEXITCODE."
}
if ($Test) {
    & python -B (Join-Path $NativeTestRoot 'cohort_gate.py') --build-root $BuildRoot --sdk-root $SdkRoot --ctest $ctest
    if ($LASTEXITCODE -ne 0) {
        throw "The complete current native cohort failed with exit $LASTEXITCODE."
    }
}
