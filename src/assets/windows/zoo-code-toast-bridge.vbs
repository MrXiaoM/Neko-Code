' Low-latency bridge for the private zoo-code-toast protocol.
' It performs the authenticated loopback request directly with WinHTTP, then
' starts the host editor CLI hidden. No PowerShell, console, browser, HWND, or
' vscode:// activation is involved.
'
' Registry open command must be: wscript.exe "this.vbs" "%1"
' Do not put //B //Nologo in the registry — ShellExecute treats //B as UNC \B.
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

Function PadNumber(ByVal value, ByVal width)
	PadNumber = Right(String(width, "0") & CStr(value), width)
End Function

Function LogTimestamp()
	Dim current, millis
	current = Now
	millis = Int((Timer - Int(Timer)) * 1000)
	LogTimestamp = Year(current) & "-" & PadNumber(Month(current), 2) & "-" & _
		PadNumber(Day(current), 2) & "T" & PadNumber(Hour(current), 2) & ":" & _
		PadNumber(Minute(current), 2) & ":" & PadNumber(Second(current), 2) & "." & _
		PadNumber(millis, 3)
End Function

Sub AppendLog(ByVal message)
	On Error Resume Next
	Dim ts
	Set ts = fso.OpenTextFile(logPath, 8, True)
	If Err.Number = 0 Then
		ts.WriteLine "[" & LogTimestamp() & "] [bridge-vbs] " & message
		ts.Close
	End If
	Err.Clear
End Sub

Function QuoteArg(ByVal value)
	QuoteArg = """" & Replace(value, """", """""") & """"
End Function

If WScript.Arguments.Count <> 1 Then
	AppendLog "reject argument-count=" & WScript.Arguments.Count
	WScript.Quit 1
End If

Dim activationUri
activationUri = WScript.Arguments(0)
AppendLog "start uri=" & activationUri

Dim uriPattern, uriMatch, port, token
Set uriPattern = New RegExp
uriPattern.Pattern = "^zoo-code-toast://approval/([0-9]{1,5})/([a-f0-9]{64})$"
uriPattern.IgnoreCase = False
uriPattern.Global = False

If Not uriPattern.Test(activationUri) Then
	AppendLog "reject invalid activation uri"
	WScript.Quit 1
End If

Set uriMatch = uriPattern.Execute(activationUri)(0)
port = CLng(uriMatch.SubMatches(0))
token = uriMatch.SubMatches(1)
If port < 1024 Or port > 65535 Then
	AppendLog "reject invalid port=" & port
	WScript.Quit 1
End If

Dim callbackUrl, request
callbackUrl = "http://127.0.0.1:" & port & "/approval-focus/" & token
AppendLog "http start url=" & callbackUrl
Set request = CreateObject("WinHttp.WinHttpRequest.5.1")
If Err.Number <> 0 Then
	AppendLog "WinHTTP create failed err=" & Err.Number & " desc=" & Err.Description
	WScript.Quit 1
End If
Err.Clear

request.SetTimeouts 1000, 1000, 1000, 3000
request.Open "GET", callbackUrl, False
request.SetRequestHeader "X-Zoo-Code-Toast-Bridge", "1"
request.Send
If Err.Number <> 0 Then
	AppendLog "http failed err=" & Err.Number & " desc=" & Err.Description
	WScript.Quit 1
End If

Dim statusCode, responseBody
statusCode = request.Status
responseBody = request.ResponseText
AppendLog "http complete status=" & statusCode & " bytes=" & Len(responseBody)
If statusCode <> 200 Then
	AppendLog "reject http status=" & statusCode
	WScript.Quit 1
End If

Dim normalizedBody, lines
normalizedBody = Replace(responseBody, vbCrLf, vbLf)
normalizedBody = Replace(normalizedBody, vbCr, vbLf)
Do While Right(normalizedBody, 1) = vbLf
	normalizedBody = Left(normalizedBody, Len(normalizedBody) - 1)
Loop
lines = Split(normalizedBody, vbLf)
If UBound(lines) <> 2 Or lines(0) <> "ok" Then
	AppendLog "reject response lines=" & (UBound(lines) + 1)
	WScript.Quit 1
End If

Dim editorPath, workspaceFolder
editorPath = lines(1)
workspaceFolder = lines(2)
If Len(editorPath) = 0 Or InStr(editorPath, """") > 0 Then
	AppendLog "reject invalid editor path"
	WScript.Quit 1
End If
If Len(workspaceFolder) = 0 Or InStr(workspaceFolder, """") > 0 Then
	AppendLog "reject invalid workspace path"
	WScript.Quit 1
End If
If Not fso.FileExists(editorPath) Then
	AppendLog "reject missing editor=" & editorPath
	WScript.Quit 1
End If
If Not fso.FolderExists(workspaceFolder) Then
	AppendLog "reject missing workspace=" & workspaceFolder
	WScript.Quit 1
End If

Dim command, processId
command = QuoteArg(editorPath) & " --reuse-window " & QuoteArg(workspaceFolder)
AppendLog "cli launch editor=" & editorPath & " workspace=" & workspaceFolder

' Window style 0 hides the CLI batch wrapper and cmd host. False avoids waiting
' for the CLI process to exit; the extension logs the actual focused event.
processId = shell.Run(command, 0, False)
If Err.Number <> 0 Then
	AppendLog "cli launch failed err=" & Err.Number & " desc=" & Err.Description
	WScript.Quit 1
End If

AppendLog "cli launch requested"
WScript.Quit 0
