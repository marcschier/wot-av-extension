$NativeRepoRoot = $PSScriptRoot
while (-not (Test-Path -LiteralPath (Join-Path $NativeRepoRoot 'onvif\samples\reference-runtime\native-media\CMakeLists.txt') -PathType Leaf)) {
    $parent = Split-Path -Parent $NativeRepoRoot
    if (-not $parent -or $parent -eq $NativeRepoRoot) {
        throw 'Cannot locate the native reference-runtime repository.'
    }
    $NativeRepoRoot = $parent
}
$NativeProjectRoot = Join-Path $NativeRepoRoot 'onvif\samples\reference-runtime\native-media'
$NativeToolRoot = Join-Path $NativeRepoRoot 'onvif\tools\native-media'
$NativeTestRoot = Join-Path $NativeRepoRoot 'onvif\tools\tests\native-media'
$NativeFixtureRoot = Join-Path $NativeRepoRoot 'onvif\tools\fixtures\native-media'
