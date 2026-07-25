# Zoo Code approval toast — short-lived PS after Show(); click uses protocol activation.
# AppId is the host editor AUMID so Action Center attributes the toast to VS Code, not PowerShell.
$ErrorActionPreference = 'Stop'
# Force UTF-8 console/pipeline so Chinese exception text is not GBK-decoded as mojibake in Node logs.
try {
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [Console]::OutputEncoding = $utf8
  [Console]::InputEncoding = $utf8
  $OutputEncoding = $utf8
  $null = cmd /c chcp 65001 >nul 2>&1
} catch {}
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml('<toast launch="zoo-code-toast://approval/8753/f18f5677fa38887edd07373143157829ead463d2433c01db225aef0fcf22702c" activationType="protocol"><visual><binding template="ToastGeneric"><text>主人快来帮我！</text><text>Mirai 想要执行：rm -f build/visual-tmp/FontCacheProbe.java build/visual-tmp/FontCacheProbe.class build/visual-tmp/VariableFontProbe.j...</text><image placement="appLogoOverride" src="file:///c:/Users/24312/.vscode/extensions/zoocodeorganization.zoo-code-3.70.0/dist/assets/icons/icon.png" hint-crop="none"/></binding></visual><actions><action content="查看" arguments="zoo-code-toast://approval/8753/f18f5677fa38887edd07373143157829ead463d2433c01db225aef0fcf22702c" activationType="protocol"/></actions><!-- tag=zoo-code-26064-5e4bb066 --></toast>')
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  $toast.Tag = 'zoo-code-26064-5e4bb066'
  $toast.Group = 'zoo-code-approval'
  $appIds = @('Microsoft.VisualStudioCode', '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe')
  $shown = $false
  foreach ($appId in $appIds) {
    try {
      $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
      $notifier.Show($toast)
      $shown = $true
      break
    } catch {
      # Try next AppId (e.g. unregistered host AUMID → PowerShell fallback).
    }
  }
  if (-not $shown) { throw 'ToastNotification.Show failed for all AppIds' }
  exit 0
} catch {
  $errText = ($_ | Out-String).Trim()
  if (-not $errText) { $errText = [string]$_ }
  try { [Console]::Error.WriteLine($errText) } catch { Write-Error $errText }
  try {
    $errLog = Join-Path $PSScriptRoot 'last-toast-ps-error.log'
    $utf8Bom = New-Object System.Text.UTF8Encoding $true
    [System.IO.File]::WriteAllText($errLog, $errText, $utf8Bom)
  } catch {}
  exit 1
}
