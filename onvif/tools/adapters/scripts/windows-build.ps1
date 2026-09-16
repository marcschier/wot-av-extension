param(
    [string]$BuildRoot = (Join-Path $PSScriptRoot '..\..\..\samples\adapters\build-windows')
)
$ErrorActionPreference = 'Stop'
$adapter = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\samples\adapters'))
$stage = Join-Path $adapter 'uvc\windows'
$build = [IO.Path]::GetFullPath($BuildRoot)
if (-not $build.StartsWith($adapter + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'BuildRoot must remain below this sample directory.'
}
$installer = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer'
$vswhere = Join-Path $installer 'vswhere.exe'
$vs = & $vswhere -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $vs) { throw 'An installed MSVC x64 environment is required.' }
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
$cmake = (Get-Command cmake -ErrorAction Stop).Source
$ninja = (Get-Command ninja -ErrorAction Stop).Source
$line = 'set "PATH={0};%PATH%" && call "{1}" >nul && "{2}" -S "{3}" -B "{4}" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_MAKE_PROGRAM="{5}" && "{2}" --build "{4}"' -f $installer,$vcvars,$cmake,$stage,$build,$ninja
& $env:ComSpec /d /s /c $line
if ($LASTEXITCODE -ne 0) { throw 'Native sample build failed.' }
