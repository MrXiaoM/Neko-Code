import { execa } from "execa"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import { Package } from "../../shared/package"
import { t } from "../../i18n"

/** When true, the next time this VS Code window gains OS focus we open Zoo Code UI. */
let pendingFocusOnWindowFocus = false
let windowStateListenerRegistered = false

/**
 * Normalize workspace folder paths for equality checks across windows.
 * Handles drive-letter case, slash style, and trailing separators on win32.
 */
export function normalizeWorkspacePath(fsPath: string): string {
	let normalized = path.normalize(fsPath.trim())
	// Drop trailing separators (keep root like "C:\" as-is after normalize quirks)
	if (normalized.length > 1) {
		normalized = normalized.replace(/[\\/]+$/, "")
	}
	if (process.platform === "win32") {
		normalized = normalized.toLowerCase()
	}
	return normalized
}

export function getWorkspaceFolderPath(): string | undefined {
	try {
		return vscode.workspace?.workspaceFolders?.[0]?.uri.fsPath
	} catch {
		return undefined
	}
}

/**
 * Whether this VS Code window should run the approval UI focus for a toast click.
 * - Missing `targetWs` (legacy URI): current window handles it.
 * - Matching workspace (normalized): this instance focuses sidebar/input.
 * - Mismatch: this instance must not steal focus; caller should --reuse-window forward.
 */
export function isApprovalFocusTargetThisWindow(
	targetWs: string | null | undefined,
	currentWs: string | null | undefined = getWorkspaceFolderPath(),
): boolean {
	if (!targetWs) {
		return true
	}
	if (!currentWs) {
		return false
	}
	return normalizeWorkspacePath(targetWs) === normalizeWorkspacePath(currentWs)
}

/**
 * Editor binary used for multi-window routing (`--reuse-window <folder>`).
 * Extension host `process.execPath` is the host editor (Code / Cursor / etc.).
 */
export function resolveEditorExecutablePath(): string {
	return process.execPath
}

/**
 * Shell for fire-and-forget host commands (toast / notify / reuse-window).
 * Matches {@link showWindowsSystemToast} + ExecaTerminalProcess: bind options then tagged template.
 */
function getNotificationExecaShell(): string | true {
	return process.platform === "win32" ? "C:\\Windows\\System32\\cmd.exe" : true
}

/** Quote a single argument for the platform shell used by notification execa. */
function quoteShellArg(value: string): string {
	if (process.platform === "win32") {
		return `"${value.replace(/"/g, '""')}"`
	}
	return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Spawn a short-lived shell command with the same execa style as showWindowsSystemToast.
 * Callers should `void child.then(...)` for logging; do not detach/unref.
 */
function spawnNotificationShellCommand(command: string, options?: { cwd?: string }): ReturnType<typeof execa> {
	return execa({
		shell: getNotificationExecaShell(),
		cwd: options?.cwd,
		all: true,
		stdin: "ignore",
		env: {
			LANG: "en_US.UTF-8",
			LC_ALL: "en_US.UTF-8",
		},
	})`${command}`
}

/**
 * Bring the VS Code window that already has `workspaceFolder` open to the front.
 * Used only when protocol activation landed in the wrong window (multi-window).
 * Does not focus Zoo Code UI here — the matching window may also receive the URI.
 */
export function focusTargetWorkspaceWindow(workspaceFolder: string): void {
	const editor = resolveEditorExecutablePath()
	try {
		const command = `${quoteShellArg(editor)} --reuse-window ${quoteShellArg(workspaceFolder)}`
		const child = spawnNotificationShellCommand(command)
		appendToastLog(`reuse-window forward editor=${editor} folder=${workspaceFolder} pid=${child.pid ?? "unknown"}`)
		void child.then(
			(result) => {
				appendToastLog(`reuse-window forward close code=${result.exitCode}`)
			},
			(error) => {
				console.error("[approvalNotification] Failed to reuse-window target workspace:", error)
				appendToastLog(`reuse-window forward failed: ${String(error)}`)
			},
		)
	} catch (error) {
		console.error("[approvalNotification] Failed to reuse-window target workspace:", error)
		appendToastLog(`reuse-window forward failed: ${String(error)}`)
	}
}

/**
 * Protocol URI opened when the user clicks the Windows system toast.
 * Carries the originating workspace so multi-window hosts can route precisely:
 *   vscode://publisher.name/focus-approval?ws=<fsPath>&k=<instanceKey>
 * VS Code / Cursor protocol handler → handleUri → match ws → focusZooCodeForApproval
 * or mismatch → focusTargetWorkspaceWindow(ws).
 */
export function buildApprovalFocusUri(): string {
	const base = `${vscode.env.uriScheme}://${Package.publisher}.${Package.name}/focus-approval`
	const params = new URLSearchParams()
	const ws = getWorkspaceFolderPath()
	if (ws) {
		params.set("ws", ws)
	}
	params.set("k", getInstanceKey())
	const query = params.toString()
	return query ? `${base}?${query}` : base
}

function ensureWindowFocusListener(): void {
	if (windowStateListenerRegistered) {
		return
	}
	windowStateListenerRegistered = true
	vscode.window.onDidChangeWindowState((state) => {
		if (state.focused && pendingFocusOnWindowFocus) {
			pendingFocusOnWindowFocus = false
			void focusZooCodeForApproval()
		}
	})
}

/** Local timestamp with offset (never bare UTC Z). */
export function formatLocalLogTimestamp(date = new Date()): string {
	const pad = (n: number, width = 2) => String(n).padStart(width, "0")
	const y = date.getFullYear()
	const m = pad(date.getMonth() + 1)
	const d = pad(date.getDate())
	const h = pad(date.getHours())
	const min = pad(date.getMinutes())
	const s = pad(date.getSeconds())
	const ms = pad(date.getMilliseconds(), 3)
	const offsetMin = -date.getTimezoneOffset()
	const sign = offsetMin >= 0 ? "+" : "-"
	const abs = Math.abs(offsetMin)
	const oh = pad(Math.floor(abs / 60))
	const om = pad(abs % 60)
	return `${y}-${m}-${d}T${h}:${min}:${s}.${ms}${sign}${oh}:${om}`
}

function toastTempDir(): string {
	const tmpDir = path.join(os.tmpdir(), "zoo-code-toasts")
	fs.mkdirSync(tmpDir, { recursive: true })
	return tmpDir
}

function appendToastLog(message: string): void {
	try {
		fs.appendFileSync(path.join(toastTempDir(), "last-toast.log"), `[${formatLocalLogTimestamp()}] ${message}\n`)
	} catch {
		// ignore
	}
}

/**
 * Per-VS-Code-instance identity so concurrent windows do not clobber each other.
 */
export function getInstanceKey(): string {
	const folder = getWorkspaceFolderPath() || "noworkspace"
	const safeFolder = folder.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-48)
	return `${process.pid}-${safeFolder}`
}

export function getApprovalToastId(): string {
	return `zoo-code-approval-${getInstanceKey()}`
}

export function resolveToastIconPath(): string | undefined {
	const fileName = "icon.png"
	const candidates = [
		path.join(__dirname, "assets", "icons", fileName),
		path.join(__dirname, "..", "assets", "icons", fileName),
		path.join(__dirname, "..", "..", "assets", "icons", fileName),
		path.join(__dirname, "..", "..", "src", "assets", "icons", fileName),
	]
	for (const c of candidates) {
		try {
			if (fs.existsSync(c)) {
				return c
			}
		} catch {
			// continue
		}
	}
	return undefined
}

/**
 * Escape text for inclusion in toast XML attribute/text nodes.
 * Entity names are built via concatenation so tooling cannot strip them.
 */
export function escapeXmlForToast(value: string): string {
	const amp = "&" + "amp;"
	const lt = "&" + "lt;"
	const gt = "&" + "gt;"
	const quot = "&" + "quot;"
	const apos = "&" + "apos;"
	return value.replace(/&/g, amp).replace(/</g, lt).replace(/>/g, gt).replace(/"/g, quot).replace(/'/g, apos)
}

/**
 * Collapse whitespace/newlines so toast XML text nodes stay single-line.
 * Multi-line command bodies break PowerShell single-quoted LoadXml('...') literals.
 */
export function sanitizeToastDisplayText(value: string): string {
	return value.replace(/\s+/g, " ").trim()
}

/**
 * Build toast payload XML. Click (body or button) launches protocol URI via protocol activation.
 * Tag is instance-scoped so multi-window toasts do not fully clobber each other in Action Center.
 */
export function buildWindowsToastXml(options: {
	title: string
	body: string
	actions: string[]
	launchUri: string
	tag: string
	iconPath?: string
}): string {
	const title = escapeXmlForToast(sanitizeToastDisplayText(options.title))
	const body = escapeXmlForToast(sanitizeToastDisplayText(options.body))
	const launch = escapeXmlForToast(options.launchUri)
	const tag = escapeXmlForToast(options.tag)

	const image =
		options.iconPath && fs.existsSync(options.iconPath)
			? `<image placement="appLogoOverride" src="${escapeXmlForToast(pathToFileUrl(options.iconPath))}" hint-crop="none"/>`
			: ""

	const buttons = options.actions
		.map((label) => {
			const escaped = escapeXmlForToast(label)
			// Same protocol for every action — focus is the only goal.
			return `<action content="${escaped}" arguments="${launch}" activationType="protocol"/>`
		})
		.join("")

	// launch on toast = body click; actions also protocol.
	return [
		`<toast launch="${launch}" activationType="protocol">`,
		'<visual><binding template="ToastGeneric">',
		`<text>${title}</text>`,
		`<text>${body}</text>`,
		image,
		"</binding></visual>",
		buttons ? `<actions>${buttons}</actions>` : "",
		// Tag is applied via ToastNotification.Tag in PS, not XML (kept in log only).
		`<!-- tag=${tag} -->`,
		"</toast>",
	]
		.filter(Boolean)
		.join("")
}

function pathToFileUrl(filePath: string): string {
	const normalized = path.resolve(filePath).replace(/\\/g, "/")
	if (/^[A-Za-z]:/.test(normalized)) {
		return `file:///${normalized}`
	}
	return `file://${normalized}`
}

/**
 * Classic Windows PowerShell AUMID — always registered, but Action Center labels the sender
 * "Windows PowerShell". Only used if the host-editor AUMID path fails to Show().
 */
export const WINDOWS_TOAST_POWERSHELL_AUMID =
	"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe"

/**
 * Well-known AppUserModelIDs for VS Code–family hosts.
 * These match Start Menu shortcut AUMIDs created by the official installers so Action Center
 * attributes the toast to the editor (e.g. "Visual Studio Code"), not PowerShell.
 * Zoo Code is an extension — never a standalone app identity for toasts.
 */
export const WINDOWS_TOAST_HOST_AUMIDS = {
	vscode: "Microsoft.VisualStudioCode",
	vscodeInsiders: "Microsoft.VisualStudioCodeInsiders",
	cursor: "Anysphere.Cursor",
} as const

/**
 * Resolve the WinRT toast AppId (AUMID) so notifications appear under the host editor.
 * Prefer VS Code / Insiders / Cursor registered identities over PowerShell.
 */
export function resolveWindowsToastAppId(
	env: { uriScheme?: string; appName?: string } = vscode.env,
	execPath: string = process.execPath,
): string {
	const scheme = (env.uriScheme ?? "").toLowerCase()
	const appName = (env.appName ?? "").toLowerCase()
	const exec = execPath.replace(/\\/g, "/").toLowerCase()

	if (
		scheme === "vscode-insiders" ||
		appName.includes("insiders") ||
		exec.includes("code - insiders") ||
		exec.includes("code-insiders")
	) {
		return WINDOWS_TOAST_HOST_AUMIDS.vscodeInsiders
	}

	if (scheme === "cursor" || appName.includes("cursor") || /(^|\/)cursor(\.exe)?$/.test(exec)) {
		return WINDOWS_TOAST_HOST_AUMIDS.cursor
	}

	// Stable VS Code and Code-like hosts (uriScheme vscode, Code.exe, "Visual Studio Code")
	if (
		scheme === "vscode" ||
		appName.includes("visual studio code") ||
		appName.includes("vs code") ||
		/(^|\/)code(\.exe)?$/.test(exec)
	) {
		return WINDOWS_TOAST_HOST_AUMIDS.vscode
	}

	// Unknown Electron host: still prefer VS Code AUMID over PowerShell branding.
	return WINDOWS_TOAST_HOST_AUMIDS.vscode
}

/**
 * Write UTF-8 BOM PS1 that:
 * 1) Loads WinRT toast types
 * 2) Creates ToastNotification with protocol launch
 * 3) Shows it under the host editor AUMID (VS Code / Insiders / Cursor)
 * 4) Sleeps briefly so the banner can paint, then exits (does not wait for click)
 *
 * No snoretoast, no start /wait, no show-and-focus.
 */
export function writeWindowsToastPs1(options: {
	xml: string
	tag: string
	outPath: string
	/** WinRT CreateToastNotifier AppId; defaults to {@link resolveWindowsToastAppId}. */
	appId?: string
}): string {
	// Keep LoadXml('...') a single PS string literal even if body once had newlines.
	const xmlLiteral = options.xml.replace(/\r?\n/g, " ").replace(/'/g, "''")
	const tagLiteral = options.tag.replace(/'/g, "''")

	// Prefer host editor AUMID so Action Center shows "Visual Studio Code" (etc.), not PowerShell.
	const primaryAumid = (options.appId ?? resolveWindowsToastAppId()).replace(/'/g, "''")
	const fallbackAumid = WINDOWS_TOAST_POWERSHELL_AUMID.replace(/'/g, "''")
	const script = [
		"# Zoo Code approval toast — short-lived PS after Show(); click uses protocol activation.",
		"# AppId is the host editor AUMID so Action Center attributes the toast to VS Code, not PowerShell.",
		"$ErrorActionPreference = 'Stop'",
		"[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
		"[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
		`$xml = New-Object Windows.Data.Xml.Dom.XmlDocument`,
		`$xml.LoadXml('${xmlLiteral}')`,
		"$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
		`$toast.Tag = '${tagLiteral}'`,
		`$toast.Group = 'zoo-code-approval'`,
		`$appIds = @('${primaryAumid}', '${fallbackAumid}')`,
		"$shown = $false",
		"foreach ($appId in $appIds) {",
		"  try {",
		"    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)",
		"    $notifier.Show($toast)",
		"    $shown = $true",
		"    break",
		"  } catch {",
		"    # Try next AppId (e.g. unregistered host AUMID → PowerShell fallback).",
		"  }",
		"}",
		"if (-not $shown) { throw 'ToastNotification.Show failed for all AppIds' }",
		"exit 0",
		"",
	].join("\r\n")

	fs.mkdirSync(path.dirname(options.outPath), { recursive: true })
	// UTF-8 BOM so Chinese title/body survive powershell.exe -File default encoding quirks.
	fs.writeFileSync(options.outPath, `\uFEFF${script}`, "utf8")
	return options.outPath
}

export type WindowsToastOptions = {
	title: string
	body: string
	actions?: string[]
	id?: string
}

/**
 * Windows system toast via short-lived PowerShell WinRT Show() + protocol focus.
 *
 * Abandoned: snoretoast -application (.lnk and .exe) — host: click exits 0/4 but never focuses.
 * Chain:
 *   write toast-show-<instance>.ps1 → execa powershell -NoProfile -WindowStyle Hidden -File
 *   CreateToastNotifier(host AUMID e.g. Microsoft.VisualStudioCode) → Show() → settle → exit
 *   click → vscode://publisher.name/focus-approval → handleUri → focusZooCodeForApproval
 *
 * AppId is the host editor (VS Code / Insiders / Cursor), not Zoo Code (extension is not a
 * standalone Windows app). PowerShell AUMID is only a Show() fallback if host AUMID fails.
 * No cmd /wait, no show-and-focus, no close-after spawn Code.
 */
export function showWindowsSystemToast(options: WindowsToastOptions): void {
	const title = options.title
	const body = options.body
	const toastId = options.id ?? getApprovalToastId()
	const iconPath = resolveToastIconPath()
	const reviewLabel = t("common:approvalNotification.review")
	const actions =
		options.actions !== undefined
			? options.actions
			: reviewLabel && reviewLabel !== "common:approvalNotification.review"
				? [reviewLabel]
				: ["Review"]

	const launchUri = buildApprovalFocusUri()
	const xml = buildWindowsToastXml({
		title,
		body,
		actions,
		launchUri,
		tag: toastId,
		iconPath,
	})

	const appId = resolveWindowsToastAppId()
	const scriptPath = path.join(toastTempDir(), `toast-show-${getInstanceKey()}.ps1`)
	writeWindowsToastPs1({ xml, tag: toastId, outPath: scriptPath, appId })

	appendToastLog(
		`winrt toast script=${scriptPath} id=${toastId} appId=${appId} launch=${launchUri} actions=${actions.join("|") || "(none)"} title=${title} instance=${getInstanceKey()}`,
	)

	pendingFocusOnWindowFocus = true
	ensureWindowFocusListener()

	let child: ReturnType<typeof execa>
	try {
		// Hidden window; exits right after Show(). Not a waiter for toast lifetime.
		const command = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ${scriptPath}`
		child = spawnNotificationShellCommand(command)
		//child.unref()
	} catch (error) {
		console.error("[approvalNotification] Failed to spawn PowerShell toast:", error)
		appendToastLog(`spawn powershell toast threw: ${String(error)}`)
		return
	}

	appendToastLog(`spawn powershell toast fire-and-forget pid=${child.pid ?? "unknown"} script=${scriptPath}`)

	void child.then(
		(result) => {
			appendToastLog(
				`powershell toast close code=${result.exitCode} (expected ~0; toast lifetime is Action Center, not this process)`,
			)
		},
		(error) => {
			console.error("[approvalNotification] PowerShell toast process error:", error)
			appendToastLog(`powershell toast child error: ${String(error)}`)
		},
	)
}

function showMacSystemNotification(options: { title: string; body: string }): void {
	const title = options.title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
	const body = options.body.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
	const appleScript = `display notification "${body}" with title "${title}"`
	const command = `osascript -e ${quoteShellArg(appleScript)}`
	try {
		const child = spawnNotificationShellCommand(command)
		void child.then(undefined, (error) => {
			console.error("[approvalNotification] osascript notification error:", error)
		})
	} catch (error) {
		console.error("[approvalNotification] Failed to spawn osascript notification:", error)
	}
}

function showLinuxSystemNotification(options: { title: string; body: string }): void {
	const command = [
		"notify-send",
		`--app-name=${quoteShellArg("Zoo Code")}`,
		"--expire-time=20000",
		quoteShellArg(options.title),
		quoteShellArg(options.body),
	].join(" ")
	try {
		const child = spawnNotificationShellCommand(command)
		void child.then(undefined, (error) => {
			console.error("[approvalNotification] notify-send notification error:", error)
		})
	} catch (error) {
		console.error("[approvalNotification] Failed to spawn notify-send notification:", error)
	}
}

export function buildApprovalNotificationCopy(options?: {
	ask?: string
	text?: string
	detail?: string
	title?: string
	body?: string
}): { title: string; body: string } {
	if (options?.title || options?.body) {
		return {
			title: options.title ?? t("common:approvalNotification.title"),
			body: options.body ?? options.detail ?? t("common:approvalNotification.message"),
		}
	}

	const title = t("common:approvalNotification.title")
	const ask = options?.ask || options?.detail
	const raw = options?.text?.trim()

	if (ask === "command") {
		let command = raw
		if (raw) {
			try {
				const parsed = JSON.parse(raw) as { command?: unknown }
				if (typeof parsed.command === "string" && parsed.command.trim()) {
					command = parsed.command.trim()
				}
			} catch {
				// plain command text
			}
		}
		if (command) {
			const short = command.length > 120 ? `${command.slice(0, 117)}...` : command
			return { title, body: t("common:approvalNotification.commandWithText", { command: short }) }
		}
		return { title, body: t("common:approvalNotification.command") }
	}

	if (ask === "followup") {
		return { title, body: t("common:approvalNotification.followup") }
	}

	if (ask === "completion_result") {
		const completionTitle = t("common:approvalNotification.completionTitle")
		const resolvedTitle =
			completionTitle && completionTitle !== "common:approvalNotification.completionTitle"
				? completionTitle
				: title
		if (raw) {
			const short = raw.length > 120 ? `${raw.slice(0, 117)}...` : raw
			return {
				title: resolvedTitle,
				body: t("common:approvalNotification.completionWithText", { result: short }),
			}
		}
		return { title: resolvedTitle, body: t("common:approvalNotification.completion") }
	}

	if (ask === "use_mcp_server") {
		return { title, body: t("common:approvalNotification.use_mcp_server") }
	}

	if (ask === "tool") {
		let toolName: string | undefined
		if (raw) {
			try {
				const parsed = JSON.parse(raw) as { tool?: unknown }
				if (typeof parsed.tool === "string") {
					toolName = parsed.tool
				}
			} catch {
				// ignore
			}
		}
		if (
			toolName &&
			[
				"editedExistingFile",
				"appliedDiff",
				"newFileCreated",
				"applyDiff",
				"searchAndReplace",
				"insertContent",
				"writeToFile",
				"edit",
				"editFile",
				"applyPatch",
				"generateImage",
			].includes(toolName)
		) {
			return { title, body: t("common:approvalNotification.toolEdit") }
		}
		if (toolName === "readFile") {
			return { title, body: t("common:approvalNotification.toolRead") }
		}
		if (toolName === "listFilesTopLevel" || toolName === "listFilesRecursive" || toolName === "listFiles") {
			return { title, body: t("common:approvalNotification.toolList") }
		}
		if (toolName === "searchFiles" || toolName === "codebaseSearch") {
			return { title, body: t("common:approvalNotification.toolSearch") }
		}
		return { title, body: t("common:approvalNotification.tool") }
	}

	if (options?.detail) {
		return { title, body: t("common:approvalNotification.messageWithDetail", { detail: options.detail }) }
	}

	return { title, body: t("common:approvalNotification.message") }
}

export async function showSystemNotification(options?: {
	detail?: string
	ask?: string
	text?: string
	title?: string
	body?: string
	actions?: string[]
}): Promise<void> {
	try {
		ensureWindowFocusListener()

		const { title, body } = buildApprovalNotificationCopy(options)

		console.log(
			`[approvalNotification] showSystemNotification platform=${process.platform} focused=${vscode.window.state.focused} title=${title}`,
		)

		if (process.platform === "win32") {
			showWindowsSystemToast({ title, body, actions: options?.actions })
			return
		}

		pendingFocusOnWindowFocus = true
		if (process.platform === "darwin") {
			showMacSystemNotification({ title, body })
			return
		}
		if (process.platform === "linux") {
			showLinuxSystemNotification({ title, body })
			return
		}
		console.warn(`[approvalNotification] Unsupported platform for system notifications: ${process.platform}`)
	} catch (error) {
		console.error("[approvalNotification] Failed to show system notification:", error)
		appendToastLog(`showSystemNotification failed: ${String(error)}`)
	}
}

export async function notifyApprovalIfWindowUnfocused(options?: {
	ask?: string
	text?: string
	detail?: string
	title?: string
	body?: string
	force?: boolean
	actions?: string[]
}): Promise<void> {
	try {
		if (!options?.force && vscode.window.state.focused) {
			return
		}

		await showSystemNotification({
			ask: options?.ask ?? options?.detail,
			text: options?.text,
			detail: options?.detail,
			title: options?.title,
			body: options?.body,
			actions: options?.actions,
		})
	} catch (error) {
		console.error("[approvalNotification] Failed to show approval notification:", error)
	}
}

export async function focusZooCodeForApproval(): Promise<void> {
	try {
		await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
	} catch (error) {
		console.error("[approvalNotification] Failed to focus SidebarProvider:", error)
	}

	try {
		await vscode.commands.executeCommand(`${Package.name}.focusInput`)
	} catch (error) {
		console.error("[approvalNotification] Failed to focus input:", error)
	}
}

export function __resetApprovalNotificationStateForTests(): void {
	pendingFocusOnWindowFocus = false
	windowStateListenerRegistered = false
}
