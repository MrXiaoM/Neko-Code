param(
	[Parameter(Mandatory = $true)]
	[ValidateSet("Foreground", "ForProcess")]
	[string]$Mode,

	[int]$ProcessId = 0
)

# Resolve a top-level VS Code / Electron HWND for toast foreground activation.
# Output: one decimal HWND line, or empty. Never shows a window.
$ErrorActionPreference = "Stop"

try {
	Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class ZooHwnd {
	public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

	[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
	[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
	[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)]
	public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)]
	public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
	[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
	[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

	const uint GW_OWNER = 4;

	public static ulong CaptureForeground() {
		return (ulong)GetForegroundWindow().ToInt64();
	}

	public static ulong FindMainForPids(HashSet<uint> pids) {
		IntPtr best = IntPtr.Zero;
		int bestScore = -1;
		EnumWindows((hWnd, lParam) => {
			if (!IsWindowVisible(hWnd)) return true;
			if (GetWindow(hWnd, GW_OWNER) != IntPtr.Zero) return true;
			uint pid;
			GetWindowThreadProcessId(hWnd, out pid);
			if (!pids.Contains(pid)) return true;
			var cls = new StringBuilder(256);
			GetClassName(hWnd, cls, cls.Capacity);
			var className = cls.ToString();
			// Electron / VS Code / Cursor main chrome host window.
			if (className.IndexOf("Chrome_WidgetWin", StringComparison.OrdinalIgnoreCase) < 0) return true;
			var title = new StringBuilder(512);
			GetWindowText(hWnd, title, title.Capacity);
			if (title.Length == 0) return true;
			int score = 10 + title.Length;
			if (IsIconic(hWnd)) score -= 2;
			if (score > bestScore) {
				bestScore = score;
				best = hWnd;
			}
			return true;
		}, IntPtr.Zero);
		return best == IntPtr.Zero ? 0UL : (ulong)best.ToInt64();
	}
}
"@

	if ($Mode -eq "Foreground") {
		$hwnd = [ZooHwnd]::CaptureForeground()
		if ($hwnd -gt 0) { Write-Output $hwnd }
		exit 0
	}

	if ($ProcessId -le 0) {
		exit 1
	}

	$pids = New-Object 'System.Collections.Generic.HashSet[uint]'
	$current = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
	$guard = 0
	while ($null -ne $current -and $guard -lt 12) {
		[void]$pids.Add([uint]$current.ProcessId)
		$parentId = [int]$current.ParentProcessId
		if ($parentId -le 0 -or $pids.Contains([uint]$parentId)) { break }
		$current = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId" -ErrorAction SilentlyContinue
		$guard++
	}

	# Also include sibling electron helper processes under the same parent tree root:
	# collect children of each known pid one level deep for Code.exe groups.
	$extra = New-Object System.Collections.Generic.List[uint]
	foreach ($pid in @($pids)) {
		Get-CimInstance Win32_Process -Filter "ParentProcessId = $pid" -ErrorAction SilentlyContinue | ForEach-Object {
			$extra.Add([uint]$_.ProcessId)
		}
	}
	foreach ($pid in $extra) { [void]$pids.Add($pid) }

	$hwnd = [ZooHwnd]::FindMainForPids($pids)
	if ($hwnd -gt 0) { Write-Output $hwnd }
	exit 0
} catch {
	exit 1
}
