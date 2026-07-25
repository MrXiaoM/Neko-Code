' Hidden launcher for host CLI workspace activation after an authenticated toast callback.
' Arguments: <editor-cli-path> <workspace-folder>
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
		ts.WriteLine "[" & Now & "] [focus-vbs] " & message
		ts.Close
	End If
	Err.Clear
End Sub

Function QuoteArg(ByVal value)
	QuoteArg = """" & Replace(value, """", """""") & """"
End Function

If WScript.Arguments.Count <> 2 Then
	AppendLog "reject argument-count=" & WScript.Arguments.Count
	WScript.Quit 1
End If

Dim editorPath, workspaceFolder
editorPath = WScript.Arguments(0)
workspaceFolder = WScript.Arguments(1)

If Not fso.FileExists(editorPath) Then
	AppendLog "reject missing editor=" & editorPath
	WScript.Quit 1
End If
If Len(Trim(workspaceFolder)) = 0 Or Not fso.FolderExists(workspaceFolder) Then
	AppendLog "reject missing workspace=" & workspaceFolder
	WScript.Quit 1
End If

Dim command, exitCode
command = QuoteArg(editorPath) & " --reuse-window " & QuoteArg(workspaceFolder)
AppendLog "start editor=" & editorPath & " workspace=" & workspaceFolder

' Window style 0 prevents the CLI batch wrapper and its cmd host from becoming visible.
exitCode = shell.Run(command, 0, True)
If Err.Number <> 0 Then
	AppendLog "shell.Run failed err=" & Err.Number & " desc=" & Err.Description
	WScript.Quit 1
End If

AppendLog "host cli exit=" & exitCode
WScript.Quit exitCode
