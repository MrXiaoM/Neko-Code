[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA "Programs\NekoNotifier"),
    [string]$DataDirectory = (Join-Path $env:LOCALAPPDATA "NekoNotifier"),
    [switch]$DoNotStart
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$TaskName = "Neko Notifier"
$PackageRoot = Split-Path -Parent $PSScriptRoot
$Wheel = Get-ChildItem -Path (Join-Path $PackageRoot "wheels") -Filter "neko_notifier-*.whl" -File |
    Sort-Object Name -Descending |
    Select-Object -First 1

if (-not $Wheel) {
    throw "The package does not contain a neko-notifier wheel."
}

function Resolve-Python312 {
    $candidates = @(
        @{ Command = "py"; Arguments = @("-3.12") },
        @{ Command = "python"; Arguments = @() }
    )

    foreach ($candidate in $candidates) {
        try {
            $version = & $candidate.Command @($candidate.Arguments) -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
            if ($LASTEXITCODE -eq 0 -and $version.Trim() -eq "3.12") {
                return $candidate
            }
        } catch {
            continue
        }
    }
    throw "Python 3.12 was not found. Install Python >=3.12,<3.13 and run this script again."
}

function Remove-PathSafely([string]$PathToRemove) {
    if (Test-Path -LiteralPath $PathToRemove) {
        Remove-Item -LiteralPath $PathToRemove -Recurse -Force
    }
}

if ($env:OS -ne "Windows_NT") {
    throw "This installer supports Windows only."
}

$python = Resolve-Python312
$installFullPath = [System.IO.Path]::GetFullPath($InstallDirectory)
$dataFullPath = [System.IO.Path]::GetFullPath($DataDirectory)
$nextEnvironment = Join-Path $installFullPath ".venv-next"
$currentEnvironment = Join-Path $installFullPath ".venv"
$backupEnvironment = Join-Path $installFullPath ".venv-backup"

Write-Host "Installing Neko Notifier to $installFullPath"
Write-Host "Using data directory $dataFullPath"

New-Item -ItemType Directory -Path $installFullPath -Force | Out-Null
New-Item -ItemType Directory -Path $dataFullPath -Force | Out-Null

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

Remove-PathSafely $nextEnvironment
& $python.Command @($python.Arguments) -m venv $nextEnvironment
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create the Python virtual environment."
}

$nextPython = Join-Path $nextEnvironment "Scripts\python.exe"
& $nextPython -m pip install --disable-pip-version-check --no-index --find-links (Join-Path $PackageRoot "wheels") --upgrade $Wheel.FullName
if ($LASTEXITCODE -ne 0) {
    Remove-PathSafely $nextEnvironment
    throw "Failed to install Neko Notifier and its dependencies. Check the network connection and retry."
}

if ($existingTask) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 750
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Remove-PathSafely $backupEnvironment
if (Test-Path -LiteralPath $currentEnvironment) {
    Move-Item -LiteralPath $currentEnvironment -Destination $backupEnvironment
}
try {
    Move-Item -LiteralPath $nextEnvironment -Destination $currentEnvironment
} catch {
    if (Test-Path -LiteralPath $backupEnvironment) {
        Move-Item -LiteralPath $backupEnvironment -Destination $currentEnvironment
    }
    throw
}
Remove-PathSafely $backupEnvironment

$installedPythonw = Join-Path $currentEnvironment "Scripts\pythonw.exe"
$arguments = "-m neko_notifier --data-dir `"$dataFullPath`""
$action = New-ScheduledTaskAction -Execute $installedPythonw -Argument $arguments -WorkingDirectory $installFullPath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Neko Notifier tray approval service for Zoo Code"
Register-ScheduledTask -TaskName $TaskName -InputObject $task | Out-Null

if (-not $DoNotStart) {
    Start-ScheduledTask -TaskName $TaskName
}

Write-Host "Neko Notifier installation completed."
Write-Host "Configure Zoo Code's Neko Notifier data directory as: $dataFullPath"
