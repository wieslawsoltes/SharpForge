param([Parameter(Mandatory=$true)][string]$SdkVersion)

$ErrorActionPreference = 'Stop'
if ($SdkVersion -notin @('8.0.425', '10.0.201')) { throw 'Unreviewed x86 SDK version' }
$evidence = Join-Path $env:GITHUB_WORKSPACE 'artifacts/a05-native-width'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
Start-Transcript -Path (Join-Path $evidence 'installation.log')
try {
    # Reuse the official installer shipped in the already pinned setup-dotnet action.
    # That v4 action has no architecture input; do not pass an ignored x86 option.
    $url = 'https://raw.githubusercontent.com/actions/setup-dotnet/67a3573c9a986a3f9c594539f4ab511d57bb3ce9/externals/install-dotnet.ps1'
    $expectedHash = '7e9969069558023daf52bbf6fc55eb37032eb23c7ff55a7d6afc659d54d6c23b'
    $installer = Join-Path $env:RUNNER_TEMP 'a05-dotnet-install.ps1'
    Invoke-WebRequest -Uri $url -OutFile $installer
    $installerHash = (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($installerHash -ne $expectedHash) { throw 'Pinned official installer hash mismatch' }
    $installation = Join-Path $env:RUNNER_TEMP ('a05-dotnet-x86-' + $SdkVersion)
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Version $SdkVersion -Architecture x86 -InstallDir $installation -NoPath
    if ($LASTEXITCODE -ne 0) { throw 'Official x86 SDK installation failed' }
    $dotnet = Join-Path $installation 'dotnet.exe'
    $hostBytes = [System.IO.File]::ReadAllBytes($dotnet)
    $peOffset = [BitConverter]::ToInt32($hostBytes, 0x3c)
    if ([BitConverter]::ToUInt16($hostBytes, $peOffset + 4) -ne 0x014c) { throw 'Installed dotnet host is not x86 PE' }
    $selectedSdk = (& $dotnet --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $selectedSdk -ne $SdkVersion) { throw 'Installed SDK selection differs from the requested version' }
    $sdkInfo = & $dotnet --info
    if ($LASTEXITCODE -ne 0) { throw 'Installed SDK information probe failed' }
    $sdkInfo | Set-Content -Path (Join-Path $evidence 'dotnet-info.txt') -Encoding utf8
    $runtimeFiles = @(Get-ChildItem (Join-Path $installation 'shared/Microsoft.NETCore.App/*/coreclr.dll') | ForEach-Object {
        @{runtime = $_.Directory.Name; file = 'coreclr.dll'; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
    })
    $proof = @{
        sdk = $selectedSdk; requestedArchitecture = 'x86'; hostPeMachine = '0x014c'; installerUrl = $url; installerSha256 = $installerHash;
        dotnetHostSha256 = (Get-FileHash $dotnet -Algorithm SHA256).Hash.ToLowerInvariant();
        roslynCompilerSha256 = (Get-FileHash (Join-Path $installation "sdk/$SdkVersion/Roslyn/bincore/csc.dll") -Algorithm SHA256).Hash.ToLowerInvariant();
        runtimeFiles = $runtimeFiles
    }
    $proof | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $evidence 'installation.json') -Encoding utf8
    [System.IO.File]::WriteAllText((Join-Path $env:GITHUB_WORKSPACE 'global.json'),
        ('{"sdk":{"version":"' + $SdkVersion + '","rollForward":"disable"}}' + "`n"))
    "DOTNET_PATH=$dotnet" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
    "DOTNET_ROOT=$installation" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
} finally {
    Stop-Transcript
}
