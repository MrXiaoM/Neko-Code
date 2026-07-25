import * as fs from "fs"
import * as path from "path"

const assetsDir = path.join(__dirname, "..", "assets", "windows")

function readAsset(fileName: string): string {
	return fs.readFileSync(path.join(assetsDir, fileName), "utf8")
}

describe("Windows toast bridge asset", () => {
	it("performs the authenticated loopback request directly with WinHTTP", () => {
		const script = readAsset("zoo-code-toast-bridge.vbs")

		expect(script).toContain('CreateObject("WinHttp.WinHttpRequest.5.1")')
		expect(script).toContain('callbackUrl = "http://127.0.0.1:"')
		expect(script).toContain('request.SetRequestHeader "X-Zoo-Code-Toast-Bridge", "1"')
		expect(script).toContain("request.SetTimeouts 1000, 1000, 1000, 3000")
		expect(script).toContain('AppendLog "http start url="')
		expect(script).toContain('AppendLog "http complete status="')
	})

	it("strictly validates the private URI and three-line response", () => {
		const script = readAsset("zoo-code-toast-bridge.vbs")

		expect(script).toContain('uriPattern.Pattern = "^zoo-code-toast://approval/([0-9]{1,5})/([a-f0-9]{64})$"')
		expect(script).toContain("If port < 1024 Or port > 65535 Then")
		expect(script).toContain('If UBound(lines) <> 2 Or lines(0) <> "ok" Then')
		expect(script).toContain("If Not fso.FileExists(editorPath) Then")
		expect(script).toContain("If Not fso.FolderExists(workspaceFolder) Then")
	})

	it("starts host CLI hidden without waiting and emits millisecond stage logs", () => {
		const script = readAsset("zoo-code-toast-bridge.vbs")

		expect(script).toContain('command = QuoteArg(editorPath) & " --reuse-window " & QuoteArg(workspaceFolder)')
		expect(script).toContain("processId = shell.Run(command, 0, False)")
		expect(script).toContain('AppendLog "cli launch editor="')
		expect(script).toContain('AppendLog "cli launch requested"')
		expect(script).toContain("PadNumber(millis, 3)")
	})

	it("contains no slow PowerShell, second-stage bridge, HWND, browser, or vscode protocol path", () => {
		const script = readAsset("zoo-code-toast-bridge.vbs")
		const executableSource = script
			.split(/\r?\n/)
			.filter((line) => !line.trimStart().startsWith("'"))
			.join("\n")

		expect(executableSource).not.toMatch(/powershell|zoo-code-focus-workspace/i)
		expect(executableSource).not.toMatch(/SetForegroundWindow|AttachThreadInput|HWND/i)
		expect(executableSource).not.toMatch(/activationUri\s*=.*vscode:\/\//i)
	})
})
