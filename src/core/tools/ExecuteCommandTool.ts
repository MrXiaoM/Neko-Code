import fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import delay from "delay"

import { CommandExecutionStatus, DEFAULT_TERMINAL_OUTPUT_PREVIEW_SIZE, PersistedCommandOutput } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../task/Task"

import { ToolUse, ToolResponse } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { unescapeHtmlEntities } from "../../utils/text-normalization"
import { parseCommand } from "../../shared/parse-command"
import {
	ExitCodeDetails,
	RooTerminal,
	RooTerminalCallbacks,
	RooTerminalProvider,
	RooTerminalProcess,
	ShellIntegrationError,
	ShellIntegrationErrorDetails,
} from "../../integrations/terminal/types"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../integrations/terminal/Terminal"
import type { RooTerminalPreview } from "../../integrations/terminal/types"
import { OutputInterceptor } from "../../integrations/terminal/OutputInterceptor"
import { Package } from "../../shared/package"
import { t } from "../../i18n"
import { getTaskDirectoryPath } from "../../utils/storage"
import { BaseTool, ToolCallbacks } from "./BaseTool"

export { ShellIntegrationError } from "../../integrations/terminal/types"

export function canRetryShellIntegrationError(error: unknown): error is ShellIntegrationError {
	return error instanceof ShellIntegrationError && !error.commandSubmitted
}

export function getTerminalProviderForExecution(terminalShellIntegrationDisabled: boolean): {
	terminalProvider: RooTerminalProvider
	isCmdExeFallback: boolean
} {
	const isCmdExeFallback = !terminalShellIntegrationDisabled && Terminal.isActiveShellCmdExe()
	const terminalProvider = terminalShellIntegrationDisabled || isCmdExeFallback ? "execa" : "vscode"

	return { terminalProvider, isCmdExeFallback }
}

interface ExecuteCommandParams {
	command: string
	cwd?: string
	timeout?: number | null
}

// Final safety-net timeout for the whole command race in executeCommandInTerminal.
//
// The terminal process promise is itself bounded (see TerminalProcess's
// SHELL_EXECUTION_COMPLETE_TIMEOUT_MS fallback), so under normal operation the
// race always settles on its own. This watchdog is defense-in-depth: if the
// underlying process promise ever fails to settle (e.g. an unforeseen shell
// integration edge case on Windows + Git Bash where neither the stream closes
// nor the completion event fires), it guarantees the tool call still resolves
// in bounded time and emits a tool_result, instead of hanging the entire task
// loop with stale, disabled approval buttons in the UI.
//
// It is intentionally larger than the process-level fallback so it only ever
// fires when the lower-level guard has already failed. When no agent/user
// timeout is configured (e.g. the command is on the timeout allowlist) this is
// the only thing preventing an indefinite hang.
const COMMAND_RACE_WATCHDOG_TIMEOUT_MS = 600_000

export function resolveAgentTimeoutMs(timeoutSeconds: number | null | undefined): number {
	const requestedAgentTimeout = typeof timeoutSeconds === "number" && timeoutSeconds > 0 ? timeoutSeconds * 1000 : 0

	// In CLI runtime, stdin harnesses expect command lifetime to be governed
	// solely by commandExecutionTimeout (user setting), not model-provided
	// background timeouts.
	return process.env.ROO_CLI_RUNTIME === "1" ? 0 : requestedAgentTimeout
}

/**
 * Resolve the watchdog timeout for the command race.
 *
 * The watchdog is only armed when neither the agent timeout nor the user
 * (commandExecutionTimeout) timeout is providing an upper bound. When either is
 * present it already guarantees the race settles, so the watchdog stays off to
 * avoid second-guessing an intentionally configured limit.
 *
 * In CLI runtime the watchdog is disabled: stdin harnesses govern command
 * lifetime via commandExecutionTimeout alone.
 *
 * @returns watchdog timeout in ms, or 0 when it should not be armed
 */
export function resolveWatchdogTimeoutMs(agentTimeoutMs: number, commandExecutionTimeoutMs: number): number {
	if (process.env.ROO_CLI_RUNTIME === "1") {
		return 0
	}

	if (agentTimeoutMs > 0 || commandExecutionTimeoutMs > 0) {
		return 0
	}

	return COMMAND_RACE_WATCHDOG_TIMEOUT_MS
}

export class ExecuteCommandTool extends BaseTool<"execute_command"> {
	readonly name = "execute_command" as const

	async execute(params: ExecuteCommandParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { command, cwd: customCwd, timeout: timeoutSeconds } = params
		const { handleError, pushToolResult, askApproval } = callbacks

		try {
			if (!command) {
				task.consecutiveMistakeCount++
				task.recordToolError("execute_command")
				pushToolResult(await task.sayAndCreateMissingParamError("execute_command", "command"))
				return
			}

			const canonicalCommand = unescapeHtmlEntities(command)

			const ignoredFileAttemptedToAccess = task.rooIgnoreController?.validateCommand(canonicalCommand)

			if (ignoredFileAttemptedToAccess) {
				await task.say("rooignore_error", ignoredFileAttemptedToAccess)
				pushToolResult(formatResponse.rooIgnoreError(ignoredFileAttemptedToAccess))
				return
			}

			task.consecutiveMistakeCount = 0

			// Detect shell syntax errors (unterminated quotes, unclosed heredocs) before
			// presenting the command for approval. Surfacing this as a tool error gives
			// the agent a precise, actionable message so it can retry with a corrected
			// command, rather than receiving a generic denial from the approval dialog.
			const { parseError } = parseCommand(canonicalCommand)
			if (parseError !== null) {
				const executionId = task.lastMessageTs?.toString() ?? Date.now().toString()
				const provider = await task.providerRef.deref()
				const errorStatus: CommandExecutionStatus = {
					executionId,
					status: "error",
					message: parseError.message,
				}
				provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(errorStatus) })
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(parseError.message))
				return
			}

			const terminalShellIntegrationDisabledForApproval =
				(await (await task.providerRef.deref())?.getState())?.terminalShellIntegrationDisabled ?? true
			const terminalPreview = await getCommandTerminalPreview(task, {
				customCwd,
				terminalShellIntegrationDisabled: terminalShellIntegrationDisabledForApproval,
			})
			const didApprove = await askApproval(
				"command",
				formatCommandApprovalMessage(canonicalCommand, terminalPreview),
			)

			if (!didApprove) {
				return
			}

			const executionId = task.lastMessageTs?.toString() ?? Date.now().toString()
			const provider = await task.providerRef.deref()
			const providerState = await provider?.getState()

			const { terminalShellIntegrationDisabled = true } = providerState ?? {}

			// Get command execution timeout from VSCode configuration (in seconds)
			const commandExecutionTimeoutSeconds = vscode.workspace
				.getConfiguration(Package.name)
				.get<number>("commandExecutionTimeout", 0)

			// Get command timeout allowlist from VSCode configuration
			const commandTimeoutAllowlist = vscode.workspace
				.getConfiguration(Package.name)
				.get<string[]>("commandTimeoutAllowlist", [])

			// Check if command matches any prefix in the allowlist
			const isCommandAllowlisted = commandTimeoutAllowlist.some((prefix) =>
				canonicalCommand.startsWith(prefix.trim()),
			)

			// Convert seconds to milliseconds for internal use, but skip timeout if command is allowlisted
			const commandExecutionTimeout = isCommandAllowlisted ? 0 : commandExecutionTimeoutSeconds * 1000

			// Convert agent-specified timeout from seconds to milliseconds
			const agentTimeout = resolveAgentTimeoutMs(timeoutSeconds)

			const options: ExecuteCommandOptions = {
				executionId,
				command: canonicalCommand,
				customCwd,
				terminalShellIntegrationDisabled,
				commandExecutionTimeout,
				agentTimeout,
			}

			try {
				const [rejected, result] = await executeCommandInTerminal(task, options)

				if (rejected) {
					task.didRejectTool = true
				}

				pushToolResult(result)
			} catch (error: unknown) {
				// Invalidate pending ask from first execution to prevent race condition
				task.supersedePendingAsk()

				if (canRetryShellIntegrationError(error)) {
					// Silent retry via execa — shell startup race, command was not submitted.
					const status: CommandExecutionStatus = { executionId, status: "fallback" }
					provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })

					const [rejected, result] = await executeCommandInTerminal(task, {
						...options,
						terminalShellIntegrationDisabled: true,
					})

					if (rejected) {
						task.didRejectTool = true
					}

					pushToolResult(result)
				} else {
					// Command was submitted but shell integration lost track of it — show warning.
					await task.say("shell_integration_warning")

					if (error instanceof ShellIntegrationError) {
						pushToolResult(
							"命令已被提交到 VS Code 终端，但终端没有报告它的输出或者完成状态。不要再次自动执行命令。",
						)
					} else {
						pushToolResult(`由于终端整合出现错误，终端中的命令执行失败。`)
					}
				}
			}

			return
		} catch (error) {
			await handleError("executing command", error as Error)
			return
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"execute_command">): Promise<void> {
		const command = block.params.command
		await task.ask("command", command ?? "", block.partial).catch(() => {})
	}
}

export function formatCommandApprovalMessage(command: string, terminalInfo: RooTerminalPreview): string {
	return JSON.stringify({ command, terminalInfo })
}

export function parseCommandApprovalMessage(text: string | undefined): {
	command: string
	terminalInfo?: RooTerminalPreview
} {
	if (!text) {
		return { command: "" }
	}

	try {
		const parsed = JSON.parse(text) as { command?: unknown; terminalInfo?: RooTerminalPreview }

		if (typeof parsed.command === "string") {
			return { command: parsed.command, terminalInfo: parsed.terminalInfo }
		}
	} catch {
		// Older command messages are plain text.
	}

	return { command: text }
}

export type ExecuteCommandOptions = {
	executionId: string
	command: string
	customCwd?: string
	terminalShellIntegrationDisabled?: boolean
	commandExecutionTimeout?: number
	agentTimeout?: number
}

async function resolveWorkingDirectory(task: Task, customCwd?: string): Promise<string> {
	let workingDir: string

	if (!customCwd) {
		workingDir = task.cwd
	} else if (path.isAbsolute(customCwd)) {
		workingDir = customCwd
	} else {
		workingDir = path.resolve(task.cwd, customCwd)
	}

	await fs.access(workingDir)
	return workingDir
}

export async function getCommandTerminalPreview(
	task: Task,
	{
		customCwd,
		terminalShellIntegrationDisabled = true,
	}: Pick<ExecuteCommandOptions, "customCwd" | "terminalShellIntegrationDisabled">,
): Promise<RooTerminalPreview> {
	const workingDir = await resolveWorkingDirectory(task, customCwd)
	const { terminalProvider } = getTerminalProviderForExecution(terminalShellIntegrationDisabled)
	return TerminalRegistry.previewTerminal(workingDir, task.taskId, terminalProvider)
}

function getTerminalInfoForStatus(terminal: RooTerminal, fallbackCwd: string): RooTerminalPreview {
	return {
		provider: terminal.provider,
		cwd: terminal.getCurrentWorkingDirectory() ?? fallbackCwd,
		willReuseTerminal: true,
		terminalId: terminal.provider === "vscode" ? terminal.id : undefined,
		reuseKey: terminal.reuseKey,
		terminalProfile: terminal.provider === "vscode" ? Terminal.getTerminalProfile() : Terminal.getExecaShellPath(),
	}
}

export async function executeCommandInTerminal(
	task: Task,
	{
		executionId,
		command,
		customCwd,
		terminalShellIntegrationDisabled = true,
		commandExecutionTimeout = 0,
		agentTimeout = 0,
	}: ExecuteCommandOptions,
): Promise<[boolean, ToolResponse]> {
	// Convert milliseconds back to seconds for display purposes.
	const commandExecutionTimeoutSeconds = commandExecutionTimeout / 1000
	let workingDir: string

	try {
		workingDir = await resolveWorkingDirectory(task, customCwd)
	} catch (error) {
		const requestedWorkingDir = !customCwd
			? task.cwd
			: path.isAbsolute(customCwd)
				? customCwd
				: path.resolve(task.cwd, customCwd)
		return [false, `指定的工作目录 '${requestedWorkingDir}' 不存在。`]
	}

	let message: { text?: string; images?: string[] } | undefined
	let runInBackground = false
	let completed = false
	let result: string = ""
	let persistedResult: PersistedCommandOutput | undefined
	let exitDetails: ExitCodeDetails | undefined
	let shellIntegrationError: ShellIntegrationError | undefined
	let hasAskedForCommandOutput = false
	let terminalInfoForStatus: RooTerminalPreview | undefined

	const { terminalProvider, isCmdExeFallback } = getTerminalProviderForExecution(terminalShellIntegrationDisabled)
	const provider = await task.providerRef.deref()

	// cmd.exe can't use shell integration — tell the webview to expand the output
	// panel immediately (same effect as the retry-fallback path).
	if (isCmdExeFallback) {
		const status: CommandExecutionStatus = { executionId, status: "fallback" }
		provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
	}

	// Get global storage path for persisted output artifacts
	const globalStoragePath = provider?.context?.globalStorageUri?.fsPath
	let interceptor: OutputInterceptor | undefined

	// Create OutputInterceptor if we have storage available
	if (globalStoragePath) {
		const taskDir = await getTaskDirectoryPath(globalStoragePath, task.taskId)
		const storageDir = path.join(taskDir, "command-output")
		const providerState = await provider?.getState()
		const terminalOutputPreviewSize =
			providerState?.terminalOutputPreviewSize ?? DEFAULT_TERMINAL_OUTPUT_PREVIEW_SIZE

		interceptor = new OutputInterceptor({
			executionId,
			taskId: task.taskId,
			command,
			storageDir,
			previewSize: terminalOutputPreviewSize,
		})
	}

	let accumulatedOutput = ""
	// Bound accumulated output buffer size to prevent unbounded memory growth for long-running commands.
	// The interceptor preserves full output; this buffer is only for UI display (100KB limit).
	const maxAccumulatedOutputSize = 100_000
	const commandOutputStreamThrottleMs = 150
	let latestCompressedOutput = ""
	let lastQueuedCommandOutput = ""
	let lastCommandOutputEmitAt = 0
	let pendingCommandOutputEmitTimer: NodeJS.Timeout | undefined
	let commandOutputSayChain: Promise<void> = Promise.resolve()

	const queueCommandOutputMessage = (text: string, partial: boolean, force = false): Promise<void> => {
		if (!force && text === lastQueuedCommandOutput) {
			return commandOutputSayChain
		}

		lastQueuedCommandOutput = text
		commandOutputSayChain = commandOutputSayChain
			.then(async () => {
				await task.say("command_output", text, undefined, partial, undefined, undefined, {
					isNonInteractive: true,
				})
			})
			.catch((error) => {
				console.error("[ExecuteCommandTool] Failed to publish command output:", error)
			})

		return commandOutputSayChain
	}

	const schedulePartialCommandOutputUpdate = () => {
		if (!latestCompressedOutput || completed) {
			return
		}

		const emitUpdate = () => {
			pendingCommandOutputEmitTimer = undefined
			lastCommandOutputEmitAt = Date.now()
			void queueCommandOutputMessage(latestCompressedOutput, true)
		}

		const elapsed = Date.now() - lastCommandOutputEmitAt
		if (elapsed >= commandOutputStreamThrottleMs) {
			emitUpdate()
			return
		}

		if (!pendingCommandOutputEmitTimer) {
			pendingCommandOutputEmitTimer = setTimeout(emitUpdate, commandOutputStreamThrottleMs - elapsed)
		}
	}

	// Track when onCompleted callback finishes to avoid race condition.
	// The callback is async but Terminal/ExecaTerminal don't await it, so we track completion
	// explicitly to ensure persistedResult is set before we use it.
	let resolveOnCompleted: (() => void) | undefined
	const onCompletedPromise = new Promise<void>((resolve) => {
		resolveOnCompleted = resolve
	})

	const callbacks: RooTerminalCallbacks = {
		onLine: async (lines: string, process: RooTerminalProcess) => {
			accumulatedOutput += lines

			// Trim accumulated output to prevent unbounded memory growth
			if (accumulatedOutput.length > maxAccumulatedOutputSize) {
				accumulatedOutput = accumulatedOutput.slice(-maxAccumulatedOutputSize)
			}

			// Write to interceptor for persisted output
			interceptor?.write(lines)

			// Continue sending compressed output to webview for UI display (unchanged behavior)
			const compressedOutput = Terminal.compressTerminalOutput(accumulatedOutput)
			latestCompressedOutput = compressedOutput
			const status: CommandExecutionStatus = { executionId, status: "output", output: compressedOutput }
			provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
			schedulePartialCommandOutputUpdate()

			if (runInBackground || hasAskedForCommandOutput) {
				return
			}

			// Mark that we've asked to prevent multiple concurrent asks
			hasAskedForCommandOutput = true

			try {
				const { response, text, images } = await task.ask("command_output", "")
				runInBackground = true

				if (response === "messageResponse") {
					message = { text, images }
					process.continue()
				}
			} catch (_error) {
				// Silently handle ask errors (e.g., "Current ask promise was ignored")
			}
		},
		onCompleted: async (output: string | undefined) => {
			clearTimeout(pendingCommandOutputEmitTimer)
			pendingCommandOutputEmitTimer = undefined

			try {
				// Finalize interceptor and get persisted result.
				// We await finalize() to ensure the artifact file is fully flushed
				// before we advertise the artifact_id to the LLM.
				if (interceptor) {
					persistedResult = await interceptor.finalize()
				}
			} catch (error) {
				console.error("[ExecuteCommandTool] interceptor.finalize() failed:", error)
			}

			// Continue using compressed output for UI display
			result = Terminal.compressTerminalOutput(output ?? "")
			latestCompressedOutput = result
			completed = true

			// Unblock the main code path: persistedResult, result, and completed are
			// all set now. Resolve before draining the UI say chain so that a stalled
			// or slow webview update cannot prevent the tool result from being returned.
			resolveOnCompleted?.()

			// Preserve order: wait for queued partial updates, then emit the final
			// non-partial command_output update. Fire-and-forget from the main path —
			// errors here are UI-only and must not surface to the tool result.
			commandOutputSayChain
				.then(() => queueCommandOutputMessage(result, false, true))
				.catch((error) => {
					console.error("[ExecuteCommandTool] Failed to flush final command_output:", error)
				})
		},
		onShellExecutionStarted: (pid: number | undefined) => {
			const status: CommandExecutionStatus = {
				executionId,
				status: "started",
				pid,
				command,
			}
			provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
		},
		onShellExecutionComplete: (details: ExitCodeDetails) => {
			const status: CommandExecutionStatus = { executionId, status: "exited", exitCode: details.exitCode }
			provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
			exitDetails = details
		},
	}

	if (terminalProvider === "vscode") {
		callbacks.onNoShellIntegration = async (details: ShellIntegrationErrorDetails) => {
			TelemetryService.instance.captureShellIntegrationError(task.taskId)
			shellIntegrationError = new ShellIntegrationError(details.message, details.commandSubmitted)
		}
	}

	const terminal = await TerminalRegistry.getOrCreateTerminal(workingDir, task.taskId, terminalProvider)
	terminalInfoForStatus = getTerminalInfoForStatus(terminal, workingDir)

	if (terminal instanceof Terminal) {
		terminal.terminal.show(true)

		// Update the working directory in case the terminal we asked for has
		// a different working directory so that the model will know where the
		// command actually executed.
		workingDir = terminal.getCurrentWorkingDirectory()
		terminalInfoForStatus = getTerminalInfoForStatus(terminal, workingDir)
	}

	const process = terminal.runCommand(command, callbacks)
	task.terminalProcess = process

	// Dual-timeout logic:
	// - Agent timeout: transitions the command to background (continues running)
	// - User timeout: aborts the command (kills it)
	// Both timers run independently — the user timeout remains active as a safety net
	// even after the agent timeout moves the command to the background.
	let agentTimeoutId: NodeJS.Timeout | undefined
	let userTimeoutId: NodeJS.Timeout | undefined
	let watchdogTimeoutId: NodeJS.Timeout | undefined
	let isUserTimedOut = false
	let isWatchdogTimedOut = false

	try {
		const racers: Promise<void>[] = [process]

		// Agent timeout: transition to background (command keeps running)
		if (agentTimeout > 0) {
			racers.push(
				new Promise<void>((resolve) => {
					agentTimeoutId = setTimeout(() => {
						runInBackground = true
						process.continue()
						task.supersedePendingAsk()
						resolve()
					}, agentTimeout)
				}),
			)
		}

		// User timeout: abort the command (existing behavior)
		if (commandExecutionTimeout > 0) {
			racers.push(
				new Promise<void>((_, reject) => {
					userTimeoutId = setTimeout(() => {
						isUserTimedOut = true
						task.terminalProcess?.abort()
						reject(new Error(`在 ${commandExecutionTimeout}ms 后，命令执行超时`))
					}, commandExecutionTimeout)
				}),
			)
		}

		// Watchdog safety net (final backstop): the `process` promise should
		// always resolve on its own — TerminalProcess.run() now bounds its wait
		// for the shell_execution_complete event, and the no-shell-integration
		// paths emit "continue" synchronously. This watchdog exists purely as a
		// defense-in-depth measure: if some future change or unforeseen
		// terminal-provider behavior ever leaves `process` pending, this ensures
		// the race still settles in bounded time so the tool ALWAYS produces a
		// tool_result instead of hanging the entire task loop (which previously
		// left the UI with stale, disabled approval buttons and no stop button).
		//
		// It is only armed when neither the agent nor a user timeout is already
		// providing an upper bound, so it never shortens an intentional timeout.
		const watchdogTimeout = resolveWatchdogTimeoutMs(agentTimeout, commandExecutionTimeout)
		if (watchdogTimeout > 0) {
			racers.push(
				new Promise<void>((resolve) => {
					watchdogTimeoutId = setTimeout(() => {
						isWatchdogTimedOut = true
						runInBackground = true
						// Nudge the process to wrap up and release any pending ask
						// so downstream bookkeeping stays consistent.
						task.terminalProcess?.continue()
						task.supersedePendingAsk()
						resolve()
					}, watchdogTimeout)
				}),
			)
		}

		await Promise.race(racers)
	} catch (error) {
		if (isUserTimedOut) {
			const status: CommandExecutionStatus = { executionId, status: "timeout" }
			provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
			await task.say("error", t("common:errors:command_timeout", { seconds: commandExecutionTimeoutSeconds }))
			task.didToolFailInCurrentTurn = true
			task.terminalProcess = undefined

			return [
				false,
				`命令执行后的 ${commandExecutionTimeoutSeconds}s 后，因为超过了用户配置的超时时间而被终止。不要尝试重新运行命令。`,
			]
		}
		throw error
	} finally {
		clearTimeout(agentTimeoutId)
		clearTimeout(userTimeoutId)
		clearTimeout(watchdogTimeoutId)
		clearTimeout(pendingCommandOutputEmitTimer)
		task.terminalProcess = undefined
	}

	if (shellIntegrationError) {
		throw shellIntegrationError
	}

	// Watchdog backstop fired: the process never settled on its own within the
	// bounded window. Surface a clear, actionable tool_result instead of hanging
	// the task loop. We return rejected=false (this is not a user rejection) and
	// tell the agent not to blindly re-run, since the command may have actually
	// completed in the terminal even though we never received its status.
	if (isWatchdogTimedOut) {
		const status: CommandExecutionStatus = { executionId, status: "exited", exitCode: undefined }
		provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
		task.didToolFailInCurrentTurn = true

		const currentWorkingDir = terminal.getCurrentWorkingDirectory().toPosix()
		return [
			false,
			[
				`命令已被提交到终端，工作目录为 '${currentWorkingDir}'，但终端没有在预期时间内报告它的完成状态（可能是终端整合的问题）。`,
				result.length > 0 ? `这是目前为止的输出截取内容：\n${result}\n` : "\n",
				"命令可能实际上已经完成。不要自动重新运行；如果你需要确认结果，请检查终端或者询问用户。",
			].join("\n"),
		]
	}

	// Wait for a short delay to ensure all messages are sent to the webview.
	// This delay allows time for non-awaited promises to be created and
	// for their associated messages to be sent to the webview, maintaining
	// the correct order of messages (although the webview is smart about
	// grouping command_output messages despite any gaps anyways).
	await delay(50)

	// Wait for onCompleted callback to finish. onCompleted is async and sets
	// `completed` and `persistedResult`; we must not read them until it resolves.
	// Skip when returning a background result: the command is still running and
	// onCompleted will fire later — awaiting it here would block until real completion,
	// defeating the purpose of the agent-timeout background transition.
	if (!runInBackground) {
		await onCompletedPromise
	}

	if (message) {
		const { text, images } = message
		await task.say("user_feedback", text, images)

		return [
			true,
			formatResponse.toolResult(
				[
					`来自 '${terminal.getCurrentWorkingDirectory().toPosix()}' 的终端依旧在运行命令。`,
					result.length > 0 ? `这是目前为止的输出：\n${result}\n` : "\n",
					`<user_message>\n${text}\n</user_message>`,
				].join("\n"),
				images,
			),
		]
	} else if (completed || exitDetails) {
		const currentWorkingDir = terminal.getCurrentWorkingDirectory().toPosix()

		// Use persisted output format when output was truncated and spilled to disk
		if (persistedResult?.truncated) {
			return [false, formatPersistedOutput(persistedResult, exitDetails, currentWorkingDir)]
		}

		// Use inline format for small outputs (original behavior with exit status).
		if (exitDetails === undefined) {
			result += "<VSCE exitDetails == undefined: 终端输出与命令执行状态未知。>"
		} else if (!exitDetails.signalName && exitDetails.exitCode === undefined) {
			result += "<VSCE exit code is undefined: 终端输出与命令执行状态未知。>"
		}

		const exitStatus = formatExitStatus(exitDetails)

		return [false, `在工作目录 '${currentWorkingDir}' 的终端命令已执行完成。${exitStatus}\n输出：\n${result}`]
	} else {
		return [
			false,
			[
				`${workingDir ? `来自 '${workingDir.toPosix()}' 的` : ""}终端依然在运行命令。`,
				result.length > 0 ? `这是目前为止的输出：\n${result}\n` : "\n",
				"你将会在未来收到新的终端状态和新的输出更新。",
			].join("\n"),
		]
	}
}

/**
 * Format exit status from ExitCodeDetails
 */
function formatExitStatus(exitDetails: ExitCodeDetails | undefined): string {
	if (exitDetails === undefined) {
		return "退出码：<undefined, 通知用户>"
	}

	if (exitDetails.signalName) {
		let status = `进程已由信号 ${exitDetails.signalName} 终止`
		if (exitDetails.coreDumpPossible) {
			status += " - 可能核心转储"
		}
		return status
	}

	if (exitDetails.exitCode === undefined) {
		return "退出码：<undefined, 通知用户>"
	}

	let status = ""
	if (exitDetails.exitCode !== 0) {
		status += "命令执行不成功，如果需要的话，请检查原因并进行调整。\n"
	}
	status += `退出码：${exitDetails.exitCode}`
	return status
}

/**
 * Format persisted output result for tool response when output was truncated
 */
function formatPersistedOutput(
	result: PersistedCommandOutput,
	exitDetails: ExitCodeDetails | undefined,
	workingDir: string,
): string {
	const exitStatus = formatExitStatus(exitDetails)
	const sizeStr = formatBytes(result.totalBytes)
	const artifactId = result.artifactPath ? path.basename(result.artifactPath) : ""

	return [
		`命令已在 '${workingDir}' 执行. ${exitStatus}`,
		"",
		`输出 (${sizeStr}) 已持久化。构件 ID: ${artifactId}`,
		"",
		"预览：",
		result.preview,
		"",
		"如果有需要，请使用 read_command_output 工具来查看完整输出。",
	].join("\n")
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes}B`
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)}KB`
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export const executeCommandTool = new ExecuteCommandTool()
