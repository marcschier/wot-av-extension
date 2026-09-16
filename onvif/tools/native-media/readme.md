# Local native qualification prerequisites

The relocated tools use the exact SDK and source pins in
`onvif\samples\reference-runtime\native-media\dependencies.lock.json` and
`sources.lock.json`. An actual missing-input verification failure must precede
explicit prerequisite provisioning. Read the lock's upstream notice and
licensing advisory before accepting licenses.

For a durable, ignored developer cache, select a new `qualification-*` direct
child of this tool directory's `.cache`. The original named task-local TEMP
directories remain supported. Both fetch tools use the ownership marker
created by `fetch-sdk.ps1`; neither changes TEMP, permissions, the persisted
environment or an existing SDK. A permission denial is a stop, not a reason to
switch paths.

```powershell
$cache = Join-Path (Get-Location) 'onvif\tools\native-media\.cache\qualification-relocated-20260916'
.\onvif\tools\native-media\fetch-sdk.ps1 -AcceptUpstreamLicenses -ProvisionPortable -TaskRoot $cache
python -B onvif\tools\native-media\fetch-sources.py --task-root $cache
```

SDK provisioning verifies the locked archive SHA-256 before executing only
`/portable=1 /CURRENTUSER /TYPE=devel /TASKS= /NORESTART` mode. Source acquisition
fetches only the 28 locked public files, checks each Git blob and records its
SHA-256. No monorepo build, global installation, package upgrade, service,
driver, redistributable installation or real-device access is authorized.

Pass the cache's `sdk`, `upstream` and exact archive path, an existing Node
executable, and a new owned native build directory to
`onvif\tools\verify-onvif-native-ci.ps1 -AllowNative`. That entry point builds
with two compiler jobs, runs the complete seven-target native CTest cohort,
then runs the full Node/native media suite with freshly compiled package code.
It does not download prerequisites. SDK/build/cache files remain local and
excluded from publication; local qualification is not binary redistribution,
hardware qualification or ONVIF certification approval.
