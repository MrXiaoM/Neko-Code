param(
	[Parameter(Mandatory = $true)]
	[string]$ActivationUri
)

# This script is launched only by the private zoo-code-toast URI protocol. It must
# never forward untrusted input to a shell, a browser, or any non-loopback host.
$ErrorActionPreference = "Stop"

function Write-BridgeLog {
	param([string]$Message)
	try {
		$tmpDir = Join-Path $env:TEMP "zoo-code-toasts"
		if (-not (Test-Path -LiteralPath $tmpDir)) {
			New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
		}
		$logPath = Join-Path $tmpDir "last-toast.log"
		$stamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffK"
		Add-Content -LiteralPath $logPath -Value "[$stamp] [bridge-ps1] $Message" -Encoding utf8
	} catch {
		# never break activation on logging failure
	}
}

function Activate-WindowByHwnd {
	param([UInt64]$HwndValue)
	if ($HwndValue -eq 0) { return $false }

	Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class ZooFg {
	[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
	[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
	[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
	[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
	[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
	[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
	[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
	[DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);

	const int SW_RESTORE = 9;
	const int SW_SHOW = 5;

	public static bool Activate(UInt64 hwndValue) {
		IntPtr hWnd = new IntPtr(unchecked((long)hwndValue));
		if (hWnd == IntPtr.Zero) return false;

		AllowSetForegroundWindow(-1); // ASFW_ANY
		if (IsIconic(hWnd)) {
			ShowWindow(hWnd, SW_RESTORE);
		} else {
			ShowWindow(hWnd, SW_SHOW);
		}
		BringWindowToTop(hWnd);

		if (SetForegroundWindow(hWnd)) return true;

		// Fallback: attach input queues of current (protocol) thread and target window thread.
		uint targetPid;
		uint targetThread = GetWindowThreadProcessId(hWnd, out targetPid);
		uint currentThread = GetCurrentThreadId();
		IntPtr foreground = GetForegroundWindow();
		uint fgPid;
		uint fgThread = GetWindowThreadProcessId(foreground, out fgPid);
		bool attachedFg = false;
		bool attachedTarget = false;
		try {
			if (fgThread != 0 && fgThread != currentThread) {
				attachedFg = AttachThreadInput(currentThread, fgThread, true);
			}
			if (targetThread != 0 && targetThread != currentThread) {
				attachedTarget = AttachThreadInput(currentThread, targetThread, true);
			}
			BringWindowToTop(hWnd);
			return SetForegroundWindow(hWnd);
		} finally {
			if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
			if (attachedFg) AttachThreadInput(currentThread, fgThread, false);
		}
	}
}
"@

	$ok = [ZooFg]::Activate($HwndValue)
	Write-BridgeLog "SetForegroundWindow hwnd=$HwndValue ok=$ok"
	return $ok
}

try {
	Write-BridgeLog "start uri=$ActivationUri"

	$uri = [Uri]$ActivationUri
	if ($uri.Scheme -ne "zoo-code-toast" -or $uri.Host -ne "approval" -or $uri.Query -or $uri.Fragment) {
		Write-BridgeLog "reject invalid scheme/host/query/fragment scheme=$($uri.Scheme) host=$($uri.Host)"
		exit 1
	}

	$pathMatch = [Regex]::Match($uri.AbsolutePath, "^/(?<port>[0-9]{1,5})/(?<token>[a-f0-9]{64})$")
	if (-not $pathMatch.Success) {
		Write-BridgeLog "reject invalid path path=$($uri.AbsolutePath)"
		exit 1
	}

	$port = [int]$pathMatch.Groups["port"].Value
	if ($port -lt 1024 -or $port -gt 65535) {
		Write-BridgeLog "reject invalid port port=$port"
		exit 1
	}

	$token = $pathMatch.Groups["token"].Value
	$systemRoot = if ($env:SystemRoot) { $env:SystemRoot } else { "C:\Windows" }
	$curlPath = Join-Path $systemRoot "System32\curl.exe"
	if (-not (Test-Path -LiteralPath $curlPath -PathType Leaf)) {
		Write-BridgeLog "curl.exe missing path=$curlPath"
		exit 1
	}

	$callbackUrl = "http://127.0.0.1:$port/approval-focus/$token"
	Write-BridgeLog "curl GET $callbackUrl"
	$body = & $curlPath --silent --show-error --fail --noproxy "*" --max-time "3" --header "X-Zoo-Code-Toast-Bridge: 1" $callbackUrl 2>&1
	$exitCode = $LASTEXITCODE
	Write-BridgeLog "curl exit=$exitCode body=$body"

	if ($exitCode -ne 0) {
		exit $exitCode
	}

	$lines = @("$body" -split "(`r`n|`n|`r)" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
	if ($lines.Count -lt 1 -or $lines[0] -ne "ok") {
		Write-BridgeLog "reject unexpected response body"
		exit 1
	}

	if ($lines.Count -ge 2 -and $lines[1] -match '^[1-9][0-9]{0,17}$') {
		$null = Activate-WindowByHwnd -HwndValue ([UInt64]$lines[1])
	} else {
		Write-BridgeLog "no hwnd in response; skip SetForegroundWindow"
	}

	exit 0
} catch {
	Write-BridgeLog "exception $($_.Exception.Message)"
	exit 1
}
