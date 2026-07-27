[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA "Programs\NekoNotifier"),
    [string]$DataDirectory = (Join-Path $env:LOCALAPPDATA "NekoNotifier"),
    [switch]$DoNotStart
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$OutputDirectory = Join-Path $ProjectRoot "dist-package"
$ExtractDirectory = Join-Path $ProjectRoot ".install-staging"

& (Join-Path $PSScriptRoot "build-package.ps1") -OutputDirectory $OutputDirectory
if ($LASTEXITCODE -ne 0) {
    throw "Package build failed."
}

$archive = Get-ChildItem -Path $OutputDirectory -Filter "neko-notifier-*-windows.zip" -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
if (-not $archive) {
    throw "No Windows package archive was produced."
}

if (Test-Path -LiteralPath $ExtractDirectory) {
    Remove-Item -LiteralPath $ExtractDirectory -Recurse -Force
}
try {
    Expand-Archive -LiteralPath $archive.FullName -DestinationPath $ExtractDirectory -Force
    $installer = Join-Path $ExtractDirectory "neko-notifier\scripts\install.ps1"
    & $installer -InstallDirectory $InstallDirectory -DataDirectory $DataDirectory -DoNotStart:$DoNotStart
    if ($LASTEXITCODE -ne 0) {
        throw "Package installation failed."
    }
} finally {
    if (Test-Path -LiteralPath $ExtractDirectory) {
        Remove-Item -LiteralPath $ExtractDirectory -Recurse -Force
    }
}
