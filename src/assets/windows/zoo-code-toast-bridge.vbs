' Silent launcher for the private zoo-code-toast protocol.
' Protocol handlers that point at powershell.exe (console subsystem) can flash
' cmd.exe or Windows Terminal. wscript.exe is a Windows subsystem host; this
' script then starts PowerShell with window style 0 (fully hidden).
'
' Registry open command must be: wscript.exe "this.vbs" "%1"
' Do not put //B //Nologo in the registry — ShellExecute treats //B as UNC \\B.
Option Explicit

On Error Resume Next

Dim fso, shell, logPath, tmpDir
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
tmpDir = shell.ExpandEnvironmentStrings("%TEMP%") & "\zoo-code-toasts"
If Not fso.FolderExists(tmpDir) Then
	fso.CreateFolder tmpDir
End If
logPath = tmpDir & "\last-toast.log"

Sub AppendLog(ByVal message)
	On Error Resume Next
	Dim ts
	Set ts = fso.OpenTextFile(logPath, 8, True)
	If Err.Number = 0 Then
		ts.WriteLine "[" & Now & "] [bridge-vbs] " & message
		ts.Close
	End If
	Err.Clear
End Sub

If WScript.Arguments.Count < 1 Then
	AppendLog "missing activation uri argument"
	WScript.Quit 1
End If

Dim activationUri
activationUri = WScript.Arguments(0)
AppendLog "start uri=" & activationUri

Dim scriptDir, bridgePs1
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
bridgePs1 = fso.BuildPath(scriptDir, "zoo-code-toast-bridge.ps1")

If Not fso.FileExists(bridgePs1) Then
	AppendLog "bridge script missing path=" & bridgePs1
	WScript.Quit 1
End If

Dim systemRoot, powershellPath
systemRoot = shell.ExpandEnvironmentStrings("%SystemRoot%")
If systemRoot = "%SystemRoot%" Or Len(systemRoot) = 0 Then
	systemRoot = "C:\Windows"
End If
powershellPath = systemRoot & "\System32\WindowsPowerShell\v1.0\powershell.exe"

If Not fso.FileExists(powershellPath) Then
	AppendLog "powershell missing path=" & powershellPath
	WScript.Quit 1
End If

Function QuoteArg(ByVal value)
	QuoteArg = """" & Replace(value, """", """""") & """"
End Function

Dim command, exitCode
command = QuoteArg(powershellPath) & _
	" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & _
	QuoteArg(bridgePs1) & " " & QuoteArg(activationUri)

' 0 = hidden window; True = wait so the protocol activation process stays alive
' long enough for the loopback callback to complete.
exitCode = shell.Run(command, 0, True)
If Err.Number <> 0 Then
	AppendLog "shell.Run failed err=" & Err.Number & " desc=" & Err.Description
	WScript.Quit 1
End If

AppendLog "powershell exit=" & exitCode
WScript.Quit exitCode
