[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) "dist-package")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($env:OS -ne "Windows_NT") {
    throw "Windows packages must be built on Windows."
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StagingRoot = Join-Path $ProjectRoot ".package-staging"
$PackageRoot = Join-Path $StagingRoot "neko-notifier"
$WheelDirectory = Join-Path $PackageRoot "wheels"

if (Test-Path -LiteralPath $StagingRoot) {
    Remove-Item -LiteralPath $StagingRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $WheelDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

Push-Location $ProjectRoot
try {
    uv build --wheel --out-dir (Join-Path $ProjectRoot "dist")
    if ($LASTEXITCODE -ne 0) {
        throw "uv failed to build the project wheel."
    }

    $projectWheel = Get-ChildItem -Path (Join-Path $ProjectRoot "dist") -Filter "neko_notifier-*.whl" -File |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
    if (-not $projectWheel) {
        throw "The project wheel was not produced."
    }

    uv run --with pip python -m pip download --dest $WheelDirectory $projectWheel.FullName
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create the offline wheelhouse."
    }

    New-Item -ItemType Directory -Path (Join-Path $PackageRoot "scripts") -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "install.ps1") -Destination (Join-Path $PackageRoot "scripts\install.ps1") -Force
    Copy-Item -LiteralPath (Join-Path $ProjectRoot "README.md") -Destination (Join-Path $PackageRoot "README.md") -Force

    $version = ((Get-Content -LiteralPath (Join-Path $ProjectRoot "pyproject.toml")) |
        Select-String -Pattern '^version\s*=\s*"([^"]+)"$').Matches.Groups[1].Value
    if (-not $version) {
        throw "Could not read the project version."
    }

    $zipPath = Join-Path ([System.IO.Path]::GetFullPath($OutputDirectory)) "neko-notifier-$version-windows.zip"
    if (Test-Path -LiteralPath $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }
    Compress-Archive -Path $PackageRoot -DestinationPath $zipPath -CompressionLevel Optimal
    Write-Host "Created package: $zipPath"
} finally {
    Pop-Location
    if (Test-Path -LiteralPath $StagingRoot) {
        Remove-Item -LiteralPath $StagingRoot -Recurse -Force
    }
}
