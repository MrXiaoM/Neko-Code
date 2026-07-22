// npx vitest run integrations/notifications/__tests__/approvalNotification.spec.ts

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"
import * as fs from "fs"

import { Package } from "../../../shared/package"
import {
	__resetApprovalNotificationStateForTests,
	buildApprovalFocusUri,
	buildWindowsToastXml,
	escapeXmlForToast,
	focusTargetWorkspaceWindow,
	focusZooCodeForApproval,
	formatLocalLogTimestamp,
	getApprovalToastId,
	getInstanceKey,
	isApprovalFocusTargetThisWindow,
	normalizeWorkspacePath,
	notifyApprovalIfWindowUnfocused,
	resolveEditorExecutablePath,
	resolveWindowsToastAppId,
	sanitizeToastDisplayText,
	showWindowsSystemToast,
	WINDOWS_TOAST_HOST_AUMIDS,
	WINDOWS_TOAST_POWERSHELL_AUMID,
	writeWindowsToastPs1,
} from "../approvalNotification"

const { execaMock, execaCalls } = vi.hoisted(() => {
	const execaCalls: Array<{ options: Record<string, unknown>; command: string }> = []
	const execaMock = vi.fn()
	return { execaMock, execaCalls }
})

vi.mock("execa", () => ({
	execa: execaMock,
}))

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs")>()
	return {
		...actual,
		writeFileSync: vi.fn(),
		mkdirSync: vi.fn(),
		appendFileSync: vi.fn(),
		existsSync: vi.fn((p: string) => {
			const s = String(p).toLowerCase()
			return s.endsWith("icon.png")
		}),
	}
})

vi.mock("vscode", () => ({
	window: {
		state: { focused: true },
		onDidChangeWindowState: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		workspaceFolders: [{ name: "Zoo-Code", uri: { fsPath: "E:/Zoo-Code" } }],
	},
	env: {
		uriScheme: "vscode",
		appName: "Visual Studio Code",
	},
	commands: {
		executeCommand: vi.fn(),
	},
}))

vi.mock("../../../i18n", () => ({
	t: (key: string, options?: Record<string, string>) => {
		if (key === "common:approvalNotification.title") {
			return "Mirai"
		}
		if (key === "common:approvalNotification.message") {
			return "Mirai needs your approval to continue."
		}
		if (key === "common:approvalNotification.messageWithDetail") {
			return `Mirai needs your approval: ${options?.detail}`
		}
		if (key === "common:approvalNotification.command") {
			return "Mirai wants to execute this command"
		}
		if (key === "common:approvalNotification.commandWithText") {
			return `Mirai wants to execute: ${options?.command}`
		}
		if (key === "common:approvalNotification.tool") {
			return "Mirai wants to use a tool"
		}
		if (key === "common:approvalNotification.toolEdit") {
			return "Mirai wants to edit a file"
		}
		if (key === "common:approvalNotification.followup") {
			return "Mirai has a question"
		}
		if (key === "common:approvalNotification.review") {
			return "查看"
		}
		return key
	},
}))

type MockExecaChild = Promise<{ exitCode: number | null }> & {
	pid: number
	unref: ReturnType<typeof vi.fn>
	resolveClose: (exitCode?: number | null) => void
	rejectClose: (error: unknown) => void
}

/** Reconstruct command from execa tagged-template call: execa(opts)`${command}` */
function reconstructTaggedCommand(strings: TemplateStringsArray, values: unknown[]): string {
	let cmd = strings[0] ?? ""
	for (let i = 0; i < values.length; i++) {
		cmd += String(values[i]) + (strings[i + 1] ?? "")
	}
	return cmd
}

/**
 * Mock execa the way showWindowsSystemToast / ExecaTerminalProcess use it:
 *   execa({ shell, cwd, all, stdin, env })`${command}`
 * First call receives options and returns a template tag; the tag returns the child promise.
 */
function mockExecaChild(): MockExecaChild {
	let resolveClose!: (value: { exitCode: number | null }) => void
	let rejectClose!: (error: unknown) => void
	const promise = new Promise<{ exitCode: number | null }>((resolve, reject) => {
		resolveClose = resolve
		rejectClose = reject
	})
	const child = Object.assign(promise, {
		pid: 12345,
		unref: vi.fn(),
		resolveClose: (exitCode: number | null = 0) => resolveClose({ exitCode }),
		rejectClose: (error: unknown) => rejectClose(error),
	}) as MockExecaChild

	execaMock.mockImplementation((options: Record<string, unknown> = {}) => {
		return (strings: TemplateStringsArray, ...values: unknown[]) => {
			const command = reconstructTaggedCommand(strings, values)
			execaCalls.push({ options: options ?? {}, command })
			return child
		}
	})
	return child
}

function findPowershellToastExeca() {
	return execaCalls.find((c) => {
		const cmd = c.command.toLowerCase()
		return cmd.includes("powershell") && cmd.includes("-file") && cmd.includes("toast-show-")
	})
}

function findExecaCommand(matcher: (command: string) => boolean) {
	return execaCalls.find((c) => matcher(c.command))
}

describe("approvalNotification", () => {
	const originalPlatform = process.platform

	beforeEach(() => {
		vi.clearAllMocks()
		execaCalls.length = 0
		__resetApprovalNotificationStateForTests()
		;(vscode.window.state as { focused: boolean }).focused = true
		Object.defineProperty(process, "platform", { value: "win32", configurable: true })
		mockExecaChild()
	})

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
	})

	describe("formatLocalLogTimestamp", () => {
		it("uses local offset, not bare UTC Z", () => {
			const stamp = formatLocalLogTimestamp(new Date("2026-07-22T05:06:39.708Z"))
			expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
			expect(stamp.endsWith("Z")).toBe(false)
		})
	})

	describe("buildApprovalFocusUri", () => {
		it("builds a vscode protocol URI for focus-approval with workspace and instance key", () => {
			const uri = buildApprovalFocusUri()
			expect(uri.startsWith(`vscode://${Package.publisher}.${Package.name}/focus-approval?`)).toBe(true)
			const qs = new URL(uri).searchParams
			expect(qs.get("ws")).toBe("E:/Zoo-Code")
			expect(qs.get("k")).toBe(getInstanceKey())
		})
	})

	describe("normalizeWorkspacePath / isApprovalFocusTargetThisWindow", () => {
		it("normalizes drive letter case, slashes, and trailing separators on win32", () => {
			Object.defineProperty(process, "platform", { value: "win32", configurable: true })
			expect(normalizeWorkspacePath("E:\\Zoo-Code\\")).toBe(normalizeWorkspacePath("e:/Zoo-Code"))
			expect(normalizeWorkspacePath("E:/Zoo-Code")).toBe(normalizeWorkspacePath("e:\\Zoo-Code\\"))
		})

		it("treats missing target ws as legacy: this window handles it", () => {
			expect(isApprovalFocusTargetThisWindow(null, "E:/Zoo-Code")).toBe(true)
			expect(isApprovalFocusTargetThisWindow(undefined, "E:/Zoo-Code")).toBe(true)
			expect(isApprovalFocusTargetThisWindow("", "E:/Zoo-Code")).toBe(true)
		})

		it("matches same workspace under path normalization", () => {
			Object.defineProperty(process, "platform", { value: "win32", configurable: true })
			expect(isApprovalFocusTargetThisWindow("e:\\Zoo-Code\\", "E:/Zoo-Code")).toBe(true)
		})

		it("rejects a different workspace", () => {
			Object.defineProperty(process, "platform", { value: "win32", configurable: true })
			expect(isApprovalFocusTargetThisWindow("E:/Other-Project", "E:/Zoo-Code")).toBe(false)
		})

		it("rejects target when current window has no workspace", () => {
			// Pass null explicitly — undefined would fall through to default getWorkspaceFolderPath().
			expect(isApprovalFocusTargetThisWindow("E:/Zoo-Code", null)).toBe(false)
		})
	})

	describe("focusTargetWorkspaceWindow", () => {
		it("execas editor --reuse-window with the target folder (tagged template + shell)", () => {
			const editor = resolveEditorExecutablePath()
			focusTargetWorkspaceWindow("E:/Other-Project")
			expect(execaMock).toHaveBeenCalled()
			const call = findExecaCommand((cmd) => cmd.includes("--reuse-window") && cmd.includes("E:/Other-Project"))
			expect(call).toBeTruthy()
			expect(call!.command).toContain(editor)
			expect(call!.command).toContain("--reuse-window")
			expect(call!.command).toContain("E:/Other-Project")
			expect(call!.options).toEqual(
				expect.objectContaining({
					shell: "C:\\Windows\\System32\\cmd.exe",
					all: true,
					stdin: "ignore",
				}),
			)
			// Same fire-and-forget style as showWindowsSystemToast — no detached/unref/reject:false
			expect(call!.options).not.toHaveProperty("detached")
			expect(call!.options).not.toHaveProperty("reject")
			expect(call!.options).not.toHaveProperty("stdio")
		})
	})

	describe("multi-instance isolation", () => {
		it("includes process.pid in toast id and instance key", () => {
			expect(getInstanceKey()).toContain(String(process.pid))
			expect(getApprovalToastId()).toBe(`zoo-code-approval-${getInstanceKey()}`)
		})
	})

	describe("resolveWindowsToastAppId", () => {
		it("uses Microsoft.VisualStudioCode for stable VS Code", () => {
			expect(
				resolveWindowsToastAppId(
					{ uriScheme: "vscode", appName: "Visual Studio Code" },
					"C:\\Program Files\\Microsoft VS Code\\Code.exe",
				),
			).toBe(WINDOWS_TOAST_HOST_AUMIDS.vscode)
		})

		it("uses Insiders AUMID for vscode-insiders", () => {
			expect(
				resolveWindowsToastAppId(
					{ uriScheme: "vscode-insiders", appName: "Visual Studio Code - Insiders" },
					"C:\\Users\\x\\AppData\\Local\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe",
				),
			).toBe(WINDOWS_TOAST_HOST_AUMIDS.vscodeInsiders)
		})

		it("uses Cursor AUMID for Cursor host", () => {
			expect(
				resolveWindowsToastAppId(
					{ uriScheme: "cursor", appName: "Cursor" },
					"C:\\Users\\x\\AppData\\Local\\Programs\\cursor\\Cursor.exe",
				),
			).toBe(WINDOWS_TOAST_HOST_AUMIDS.cursor)
		})

		it("defaults to VS Code AUMID for unknown hosts (not PowerShell)", () => {
			expect(resolveWindowsToastAppId({ uriScheme: "unknown", appName: "Other" }, "C:\\app\\host.exe")).toBe(
				WINDOWS_TOAST_HOST_AUMIDS.vscode,
			)
		})
	})

	describe("toast xml / ps1", () => {
		it("escapes xml special characters", () => {
			const expectedSafe = [
				"a",
				"&" + "amp;",
				"b",
				"&" + "lt;",
				"c",
				"&" + "gt;",
				"&" + "quot;",
				"d",
				"&" + "quot;",
				"&" + "apos;",
				"e",
			].join("")
			expect(escapeXmlForToast('a&b<c>"d"\'e')).toBe(expectedSafe)
		})

		it("builds protocol-launch toast xml with Chinese and actions", () => {
			const uri = buildApprovalFocusUri()
			const xml = buildWindowsToastXml({
				title: "标题中文",
				body: "正文中文",
				actions: ["查看"],
				launchUri: uri,
				tag: getApprovalToastId(),
			})
			expect(xml).toContain('activationType="protocol"')
			// URI `&` is XML-escaped inside attributes
			expect(xml).toContain(escapeXmlForToast(uri))
			expect(xml).toContain("ws=E%3A%2FZoo-Code")
			expect(xml).toContain("标题中文")
			expect(xml).toContain("正文中文")
			expect(xml).toContain("查看")
			expect(xml).not.toContain("snoretoast")
			expect(xml).not.toContain("show-and-focus")
		})

		it("writes BOM ps1 that Shows toast under VS Code AUMID, settles, then exits (no click wait)", () => {
			const out = writeWindowsToastPs1({
				xml: "<toast></toast>",
				tag: "tag-1",
				outPath: "C:\\tmp\\toast-show-test.ps1",
			})
			expect(out).toContain("toast-show-test.ps1")
			const written = String(vi.mocked(fs.writeFileSync).mock.calls.at(-1)?.[1] ?? "")
			expect(written.charCodeAt(0)).toBe(0xfeff)
			expect(written).toContain("ToastNotificationManager")
			expect(written).toContain("Show($toast)")
			// Primary AppId is host editor (VS Code), not PowerShell branding.
			expect(written).toContain(WINDOWS_TOAST_HOST_AUMIDS.vscode)
			expect(written).toContain(
				`$appIds = @('${WINDOWS_TOAST_HOST_AUMIDS.vscode}', '${WINDOWS_TOAST_POWERSHELL_AUMID}')`,
			)
			// PowerShell AUMID is only the fallback after host AUMID.
			const primaryIdx = written.indexOf(WINDOWS_TOAST_HOST_AUMIDS.vscode)
			const fallbackIdx = written.indexOf(WINDOWS_TOAST_POWERSHELL_AUMID)
			expect(primaryIdx).toBeGreaterThan(-1)
			expect(fallbackIdx).toBeGreaterThan(primaryIdx)
			expect(written).toContain("exit 0")
			expect(written).not.toContain("snoretoast")
			expect(written).not.toContain("start /wait")
			expect(written).not.toContain("show-and-focus")
		})

		it("accepts an explicit appId override in the written script", () => {
			writeWindowsToastPs1({
				xml: "<toast></toast>",
				tag: "tag-1",
				outPath: "C:\\tmp\\toast-appid.ps1",
				appId: WINDOWS_TOAST_HOST_AUMIDS.vscodeInsiders,
			})
			const written = String(vi.mocked(fs.writeFileSync).mock.calls.at(-1)?.[1] ?? "")
			expect(written).toContain(WINDOWS_TOAST_HOST_AUMIDS.vscodeInsiders)
			expect(written).toContain(
				`$appIds = @('${WINDOWS_TOAST_HOST_AUMIDS.vscodeInsiders}', '${WINDOWS_TOAST_POWERSHELL_AUMID}')`,
			)
		})

		it("collapses newlines in toast display text for safe LoadXml", () => {
			expect(sanitizeToastDisplayText("a\nb\r\nc   d")).toBe("a b c d")
			const xml = buildWindowsToastXml({
				title: "t",
				body: "line1\nline2",
				actions: [],
				launchUri: "vscode://x/y",
				tag: "tag",
			})
			expect(xml).toContain("line1 line2")
			expect(xml).not.toMatch(/line1\nline2/)
		})

		it("flattens newlines inside LoadXml string when writing ps1", () => {
			writeWindowsToastPs1({
				xml: "<toast>\n<body>x</body>\n</toast>",
				tag: "tag-1",
				outPath: "C:\\tmp\\toast-flat.ps1",
			})
			const written = String(vi.mocked(fs.writeFileSync).mock.calls.at(-1)?.[1] ?? "")
			const loadLine = written.split(/\r?\n/).find((l) => l.includes("LoadXml("))
			expect(loadLine).toBeTruthy()
			expect(loadLine).not.toMatch(/\n/)
			expect(loadLine).toContain("LoadXml('<toast> <body>x</body> </toast>')")
		})
	})

	describe("notifyApprovalIfWindowUnfocused", () => {
		it("does nothing when the window is focused", async () => {
			;(vscode.window.state as { focused: boolean }).focused = true
			await notifyApprovalIfWindowUnfocused({ detail: "tool" })
			expect(execaMock).not.toHaveBeenCalled()
		})

		it("execas hidden PowerShell -File toast script with Chinese in written xml", async () => {
			;(vscode.window.state as { focused: boolean }).focused = false

			await notifyApprovalIfWindowUnfocused({
				ask: "command",
				text: JSON.stringify({ command: "echo hello" }),
			})

			expect(execaMock).toHaveBeenCalled()
			const call = findPowershellToastExeca()
			expect(call).toBeTruthy()
			expect(call!.command.toLowerCase()).toContain("powershell")
			expect(call!.command).toContain("-NoProfile")
			expect(call!.command).toContain("-WindowStyle")
			expect(call!.command).toContain("Hidden")
			expect(call!.command).toContain("-File")
			expect(call!.command).toContain(`toast-show-${getInstanceKey()}.ps1`)
			// Master's correct pattern: shell + all + stdin ignore (not detached/stdio/reject)
			expect(call!.options).toEqual(
				expect.objectContaining({
					shell: "C:\\Windows\\System32\\cmd.exe",
					all: true,
					stdin: "ignore",
				}),
			)
			expect(call!.options).not.toHaveProperty("detached")
			expect(call!.options).not.toHaveProperty("reject")
			expect(call!.options).not.toHaveProperty("stdio")

			// No snoretoast / cmd wait / show-and-focus main path
			expect(execaCalls.find((c) => c.command.toLowerCase().includes("snoretoast"))).toBeUndefined()
			expect(
				execaCalls.find((c) => c.command.toLowerCase().includes("cmd") && c.command.includes("/wait")),
			).toBeUndefined()

			const written = String(vi.mocked(fs.writeFileSync).mock.calls.at(-1)?.[1] ?? "")
			expect(written).toContain("Mirai")
			expect(written).toContain("echo hello")
			expect(written).toContain("查看")
			expect(written).toContain(escapeXmlForToast(buildApprovalFocusUri()))
			expect(written).toContain("ws=E%3A%2FZoo-Code")
			expect(written).toContain('activationType="protocol"')
			// Action Center sender uses VS Code host AUMID (mock appName is Visual Studio Code).
			expect(written).toContain(WINDOWS_TOAST_HOST_AUMIDS.vscode)
			expect(written.indexOf(WINDOWS_TOAST_HOST_AUMIDS.vscode)).toBeLessThan(
				written.indexOf(WINDOWS_TOAST_POWERSHELL_AUMID),
			)
		})

		it("does not execa Code after toast process close", async () => {
			;(vscode.window.state as { focused: boolean }).focused = false
			const child = mockExecaChild()

			await notifyApprovalIfWindowUnfocused({ force: true, title: "T", body: "B" })
			const n = execaMock.mock.calls.length
			child.resolveClose(0)
			await Promise.resolve()
			await Promise.resolve()

			expect(execaMock.mock.calls.length).toBe(n)
		})

		it("can force a notification even when focused", async () => {
			;(vscode.window.state as { focused: boolean }).focused = true
			await notifyApprovalIfWindowUnfocused({ detail: "tool", force: true })
			expect(execaMock).toHaveBeenCalled()
		})

		it("uses osascript on macOS when unfocused", async () => {
			Object.defineProperty(process, "platform", { value: "darwin", configurable: true })
			;(vscode.window.state as { focused: boolean }).focused = false
			await notifyApprovalIfWindowUnfocused()
			expect(execaMock).toHaveBeenCalled()
			const call = findExecaCommand((cmd) => cmd.includes("osascript") && cmd.includes("display notification"))
			expect(call).toBeTruthy()
			expect(call!.command).toContain("osascript")
			expect(call!.command).toContain("display notification")
			expect(call!.options).toEqual(
				expect.objectContaining({
					shell: true,
					all: true,
					stdin: "ignore",
				}),
			)
			expect(call!.options).not.toHaveProperty("detached")
			expect(call!.options).not.toHaveProperty("reject")
		})

		it("uses notify-send on Linux when unfocused", async () => {
			Object.defineProperty(process, "platform", { value: "linux", configurable: true })
			;(vscode.window.state as { focused: boolean }).focused = false
			await notifyApprovalIfWindowUnfocused()
			expect(execaMock).toHaveBeenCalled()
			const call = findExecaCommand((cmd) => cmd.includes("notify-send") && cmd.includes("Mirai"))
			expect(call).toBeTruthy()
			expect(call!.command).toContain("notify-send")
			expect(call!.command).toContain("Mirai")
			expect(call!.command).toContain("Mirai needs your approval to continue.")
			expect(call!.options).toEqual(
				expect.objectContaining({
					shell: true,
					all: true,
					stdin: "ignore",
				}),
			)
			expect(call!.options).not.toHaveProperty("detached")
			expect(call!.options).not.toHaveProperty("reject")
		})

		it("swallows notification errors", async () => {
			;(vscode.window.state as { focused: boolean }).focused = false
			execaMock.mockImplementation(() => {
				throw new Error("boom")
			})
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
			await expect(notifyApprovalIfWindowUnfocused()).resolves.toBeUndefined()
			expect(consoleSpy).toHaveBeenCalled()
			consoleSpy.mockRestore()
		})
	})

	describe("showWindowsSystemToast", () => {
		it("supports custom action buttons and protocol launch", () => {
			showWindowsSystemToast({
				title: "标题中文",
				body: "正文中文",
				actions: ["Approve", "Reject"],
			})

			const call = findPowershellToastExeca()
			expect(call).toBeTruthy()
			const written = String(vi.mocked(fs.writeFileSync).mock.calls.at(-1)?.[1] ?? "")
			expect(written).toContain("标题中文")
			expect(written).toContain("正文中文")
			expect(written).toContain("Approve")
			expect(written).toContain("Reject")
			expect(written).toContain(escapeXmlForToast(buildApprovalFocusUri()))
			expect(written).toContain("ws=E%3A%2FZoo-Code")
			expect(written).toContain(WINDOWS_TOAST_HOST_AUMIDS.vscode)
			expect(written).not.toContain("snoretoast")
		})
	})

	describe("focusZooCodeForApproval", () => {
		it("focuses the sidebar and input", async () => {
			vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined)
			await focusZooCodeForApproval()
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(`${Package.name}.SidebarProvider.focus`)
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(`${Package.name}.focusInput`)
		})

		it("continues if sidebar focus fails", async () => {
			vi.mocked(vscode.commands.executeCommand)
				.mockRejectedValueOnce(new Error("no sidebar"))
				.mockResolvedValueOnce(undefined)
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
			await focusZooCodeForApproval()
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(`${Package.name}.focusInput`)
			consoleSpy.mockRestore()
		})
	})
})
