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

function Decode-BridgeValue {
	param([string]$EncodedValue)
	$bytes = [Convert]::FromBase64String($EncodedValue)
	return [Text.Encoding]::UTF8.GetString($bytes)
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
	# Out-String is required here: assigning native-process output directly to a
	# variable makes PowerShell store one array item per line and "$body" joins
	# those items with spaces, turning `ok\n<value>` into `ok <value>`.
	$body = (& $curlPath --silent --show-error --fail --noproxy "*" --max-time "3" --header "X-Zoo-Code-Toast-Bridge: 1" $callbackUrl 2>&1 | Out-String).TrimEnd()
	$exitCode = $LASTEXITCODE
	$lines = @($body -split "`r`n|`n|`r" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
	$firstLine = if ($lines.Count -gt 0) { $lines[0] } else { "" }
	Write-BridgeLog "curl exit=$exitCode lines=$($lines.Count) first=$firstLine body=$body"

	if ($exitCode -ne 0) {
		exit $exitCode
	}

	if ($lines.Count -ne 4 -or $lines[0] -ne "ok") {
		Write-BridgeLog "reject unexpected response body lines=$($lines.Count)"
		exit 1
	}

	$editorPath = Decode-BridgeValue $lines[1]
	$workspaceFolder = Decode-BridgeValue $lines[2]
	$focusLauncherPath = Decode-BridgeValue $lines[3]
	Write-BridgeLog "callback accepted editor=$editorPath workspace=$workspaceFolder launcher=$focusLauncherPath"

	if (-not (Test-Path -LiteralPath $editorPath -PathType Leaf)) {
		Write-BridgeLog "reject missing editor path=$editorPath"
		exit 1
	}
	if (-not (Test-Path -LiteralPath $workspaceFolder -PathType Container)) {
		Write-BridgeLog "reject missing workspace path=$workspaceFolder"
		exit 1
	}
	if (-not (Test-Path -LiteralPath $focusLauncherPath -PathType Leaf)) {
		Write-BridgeLog "reject missing focus launcher path=$focusLauncherPath"
		exit 1
	}

	$wscriptPath = Join-Path $systemRoot "System32\wscript.exe"
	if (-not (Test-Path -LiteralPath $wscriptPath -PathType Leaf)) {
		Write-BridgeLog "reject missing wscript path=$wscriptPath"
		exit 1
	}

	Write-BridgeLog "focus launcher start"
	& $wscriptPath $focusLauncherPath $editorPath $workspaceFolder
	$focusExitCode = $LASTEXITCODE
	Write-BridgeLog "focus launcher exit=$focusExitCode"
	exit $focusExitCode
} catch {
	Write-BridgeLog "exception $($_.Exception.Message)"
	exit 1
}
