import * as fs from "fs"
import * as path from "path"

const assetsDir = path.join(__dirname, "..", "assets", "windows")

function readAsset(fileName: string): string {
	return fs.readFileSync(path.join(assetsDir, fileName), "utf8")
}

describe("Windows toast bridge assets", () => {
	it("parses the authenticated callback as four preserved lines and delegates focus", () => {
		const script = readAsset("zoo-code-toast-bridge.ps1")

		expect(script).toContain("| Out-String).TrimEnd()")
		expect(script).toContain('$body -split "`r`n|`n|`r"')
		expect(script).toContain("$lines.Count -ne 4")
		expect(script).toContain("[Convert]::FromBase64String")
		expect(script).toContain('Write-BridgeLog "callback accepted editor=')
		expect(script).toContain('Write-BridgeLog "focus launcher start"')
		expect(script).toContain('Write-BridgeLog "focus launcher exit=$focusExitCode"')
		expect(script).toContain("System32\\wscript.exe")
	})

	it("contains no HWND foreground activation code", () => {
		const source = [
			readAsset("zoo-code-toast-bridge.ps1"),
			readAsset("zoo-code-toast-bridge.vbs"),
			readAsset("zoo-code-focus-workspace.vbs"),
		].join("\n")

		expect(source).not.toMatch(/SetForegroundWindow|AttachThreadInput|GetForegroundWindow|HWND/i)
	})

	it("runs host CLI workspace routing hidden and emits stage logs", () => {
		const launcher = readAsset("zoo-code-focus-workspace.vbs")

		expect(launcher).toContain('command = QuoteArg(editorPath) & " --reuse-window " & QuoteArg(workspaceFolder)')
		expect(launcher).toContain("exitCode = shell.Run(command, 0, True)")
		expect(launcher).toContain('AppendLog "start editor="')
		expect(launcher).toContain('AppendLog "host cli exit=" & exitCode')
		expect(launcher).toContain('AppendLog "reject missing editor="')
		expect(launcher).toContain('AppendLog "reject missing workspace="')
	})
})
