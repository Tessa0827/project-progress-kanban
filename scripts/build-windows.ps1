$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$sourceRoot = Split-Path -Parent $PSScriptRoot
$stageRoot = Join-Path ([IO.Path]::GetTempPath()) ('kanban-build-' + [Guid]::NewGuid().ToString('N'))
$headers = @{ 'User-Agent' = 'ProjectProgressKanban-LocalBuild' }
New-Item -ItemType Directory -Path $stageRoot | Out-Null
try {
    Write-Host 'Preparing the Windows app. Only the Electron runtime is downloaded; your files are not uploaded.'
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/electron/electron/releases/latest' -Headers $headers
    $version = [string]$release.tag_name
    if ($version -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') { throw 'Could not determine the stable runtime version.' }
    $asset = "electron-$version-win32-x64.zip"
    $baseUrl = "https://github.com/electron/electron/releases/download/$version"
    $runtimeZip = Join-Path $stageRoot $asset
    Write-Host "Downloading $asset ..."
    Invoke-WebRequest -Uri "$baseUrl/$asset" -Headers $headers -UseBasicParsing -OutFile $runtimeZip
    $checksumFile = Join-Path $stageRoot 'SHASUMS256.txt'
    Invoke-WebRequest -Uri "$baseUrl/SHASUMS256.txt" -Headers $headers -UseBasicParsing -OutFile $checksumFile
    $assetPattern = '^([a-fA-F0-9]{64})\s+\*?' + [Regex]::Escape($asset) + '$'
    $checksum = $null
    foreach ($line in Get-Content -LiteralPath $checksumFile) { if ($line -match $assetPattern) { $checksum = $Matches[1].ToLowerInvariant(); break } }
    if (-not $checksum -or (Get-FileHash -Algorithm SHA256 -LiteralPath $runtimeZip).Hash.ToLowerInvariant() -ne $checksum) { throw 'Runtime checksum verification failed.' }
    $buildDir = Join-Path (Split-Path -Parent $sourceRoot) ('ProjectProgressKanban-Windows-' + $version + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Expand-Archive -LiteralPath $runtimeZip -DestinationPath $buildDir
    $appDir = Join-Path $buildDir 'resources\app'
    New-Item -ItemType Directory -Path $appDir | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'package.json') -Destination $appDir
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'app') -Destination $appDir -Recurse
    Rename-Item -LiteralPath (Join-Path $buildDir 'electron.exe') -NewName 'ProjectProgressKanban.exe'
    Write-Host ''
    Write-Host "Ready: $buildDir\ProjectProgressKanban.exe"
    Write-Host 'Keep the entire app folder together. You can create a desktop shortcut to the EXE.'
    Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $buildDir + '"')
} finally {
    if (Test-Path -LiteralPath $stageRoot) { Remove-Item -LiteralPath $stageRoot -Recurse -Force }
}
