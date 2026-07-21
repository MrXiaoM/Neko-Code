import { useCallback, useState, memo, useMemo } from "react"
import { useEvent } from "react-use"
import { useTranslation } from "react-i18next"
import { ChevronDown, OctagonX, SquareArrowOutUpRight } from "lucide-react"

import {
	type ExtensionMessage,
	type CommandExecutionStatus,
	type CommandTerminalInfo,
	type ApprovalState,
	commandExecutionStatusSchema,
} from "@roo-code/types"

import { safeJsonParse } from "@roo/core"
import { COMMAND_OUTPUT_STRING } from "@roo/combineCommandSequences"
import { parseCommand } from "@roo/parse-command"

import { vscode } from "@src/utils/vscode"
import { extractPatternsFromCommand } from "@src/utils/command-parser"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { cn } from "@src/lib/utils"

import { Button, StandardTooltip } from "@src/components/ui"
import CodeBlock from "@src/components/common/CodeBlock"

import { CommandPatternSelector } from "./CommandPatternSelector"
import { TerminalOutput } from "./TerminalOutput"

// Module-level cache of the most recent status for each executionId. Populated
// by every onMessage handler so that a CommandExecution component that mounts
// after the "started" event was already delivered can recover the status from
// the cache rather than staying stuck at null.
const statusCache = new Map<string, CommandExecutionStatus>()

interface CommandPattern {
	pattern: string
	description?: string
}

interface CommandExecutionProps {
	executionId: string
	text?: string
	icon?: JSX.Element | null
	title?: JSX.Element | null
	approvalState?: ApprovalState
}

export const CommandExecution = ({ executionId, text, icon, title, approvalState }: CommandExecutionProps) => {
	const { t } = useTranslation()
	const {
		terminalShellIntegrationDisabled = false,
		allowedCommands = [],
		deniedCommands = [],
		setAllowedCommands,
		setDeniedCommands,
	} = useExtensionState()

	const {
		command,
		output: parsedOutput,
		terminalInfo: approvalTerminalInfo,
	} = useMemo(() => parseCommandAndOutput(text), [text])

	// If we aren't opening the VSCode terminal for this command then we default
	// to expanding the command execution output.
	const [isExpanded, setIsExpanded] = useState(terminalShellIntegrationDisabled)
	const [streamingOutput, setStreamingOutput] = useState("")
	// Initialize from the module-level cache so that components mounting after
	// the "started" event was delivered still show the running indicator.
	const [status, setStatus] = useState<CommandExecutionStatus | null>(() => statusCache.get(executionId) ?? null)

	// The command's output can either come from the text associated with the
	// task message (this is the case for completed commands) or from the
	// streaming output (this is the case for running commands).
	const output = streamingOutput || parsedOutput
	const terminalInfo =
		status?.status === "started" && status.terminalInfo ? status.terminalInfo : approvalTerminalInfo

	// Extract command patterns from the actual command that was executed
	const commandPatterns = useMemo<CommandPattern[]>(() => {
		// First get all individual commands (including subshell commands) using parseCommand
		const { commands: allCommands } = parseCommand(command)

		// Then extract patterns from each command using the existing pattern extraction logic
		const allPatterns = new Set<string>()

		// Add all individual commands first. Multi-line patterns (e.g. heredocs,
		// unterminated quotes) are opaque tokens and must not be added verbatim --
		// their body lines would surface as approvable patterns. Only add
		// single-line commands; multi-line tokens are covered by pattern extraction.
		allCommands.forEach((cmd) => {
			if (cmd.trim() && !cmd.includes("\n")) {
				allPatterns.add(cmd.trim())
			}
		})

		// Then add extracted patterns for each command
		allCommands.forEach((cmd) => {
			const patterns = extractPatternsFromCommand(cmd)
			patterns.forEach((pattern) => allPatterns.add(pattern))
		})

		return Array.from(allPatterns).map((pattern) => ({
			pattern,
		}))
	}, [command])

	// Handle pattern changes
	const handleAllowPatternChange = (pattern: string) => {
		const isAllowed = allowedCommands.includes(pattern)
		const newAllowed = isAllowed ? allowedCommands.filter((p) => p !== pattern) : [...allowedCommands, pattern]
		const newDenied = deniedCommands.filter((p) => p !== pattern)

		setAllowedCommands(newAllowed)
		setDeniedCommands(newDenied)

		vscode.postMessage({
			type: "updateSettings",
			updatedSettings: { allowedCommands: newAllowed, deniedCommands: newDenied },
		})
	}

	const handleDenyPatternChange = (pattern: string) => {
		const isDenied = deniedCommands.includes(pattern)
		const newDenied = isDenied ? deniedCommands.filter((p) => p !== pattern) : [...deniedCommands, pattern]
		const newAllowed = allowedCommands.filter((p) => p !== pattern)

		setAllowedCommands(newAllowed)
		setDeniedCommands(newDenied)

		vscode.postMessage({
			type: "updateSettings",
			updatedSettings: { allowedCommands: newAllowed, deniedCommands: newDenied },
		})
	}

	const onMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "commandExecutionStatus") {
				const result = commandExecutionStatusSchema.safeParse(safeJsonParse(message.text, {}))

				if (result.success) {
					const data = result.data

					if (data.executionId !== executionId) {
						return
					}

					switch (data.status) {
						case "started":
							// Cache the started status so a component that mounts
							// after this event (e.g. after auto-approval causes a
							// fast remount) can recover the running indicator.
							statusCache.set(executionId, data)
							setStatus(data)
							break
						case "exited":
						case "error":
						case "timeout":
							// Terminal states clear the cache so a fresh component
							// mounting after execution ends does not inherit a stale
							// "started" entry and incorrectly show the pulse dot.
							// Map.delete on a missing key is a no-op, so duplicate
							// deletes (e.g. error followed by exited) are safe.
							statusCache.delete(executionId)
							setStatus(data)
							break
						case "fallback":
							// Not a terminal state -- signals a mid-execution retry
							// via execa after a shell integration failure. A new
							// "started" event will follow, so leave the cache intact.
							setIsExpanded(true)
							break
						case "output":
							setStreamingOutput(data.output)
							break
						default:
							setStatus(data)
							break
					}
				}
			}
		},
		[executionId],
	)

	useEvent("message", onMessage)

	const approvalLabelKey =
		approvalState === "approved"
			? "chat:commandExecution.approved"
			: approvalState === "auto_approved"
				? "chat:commandExecution.autoApproved"
				: approvalState === "rejected"
					? "chat:commandExecution.rejected"
					: null

	const approvalTooltipKey =
		approvalState === "approved"
			? "chat:commandExecution.approvedTooltip"
			: approvalState === "auto_approved"
				? "chat:commandExecution.autoApprovedTooltip"
				: approvalState === "rejected"
					? "chat:commandExecution.rejectedTooltip"
					: null

	// Never show the running indicator for commands that still need approval.
	// A stale statusCache entry (e.g. from a previous consecutive command) must
	// not make a pending approval row look like it is already executing.
	const isApprovedForExecution = approvalState === "approved" || approvalState === "auto_approved"
	const showRunningIndicator = status?.status === "started" && isApprovedForExecution

	const approvalTitle =
		approvalLabelKey !== null ? (
			<span
				className={cn(
					"font-bold",
					approvalState === "approved" && "text-green-600",
					approvalState === "auto_approved" && "text-blue-500",
					approvalState === "rejected" && "text-vscode-errorForeground",
				)}>
				{t(approvalLabelKey)}
			</span>
		) : (
			title
		)

	return (
		<>
			<div className="flex flex-row items-center justify-between gap-2 mb-1">
				<div className="flex flex-row items-center gap-2">
					{icon}
					{approvalTooltipKey ? (
						<StandardTooltip content={t(approvalTooltipKey)}>{approvalTitle}</StandardTooltip>
					) : (
						approvalTitle
					)}
					{showRunningIndicator && (
						<StandardTooltip content={t("chat:commandExecution.running")}>
							<div className="rounded-full size-2 bg-yellow-500 animate-pulse" />
						</StandardTooltip>
					)}
					{status?.status === "exited" && (
						<div className="flex flex-row items-center gap-2 font-mono text-xs">
							<StandardTooltip
								content={t("chat:commandExecution.exitStatus", { exitCode: status.exitCode })}>
								<div
									className={cn(
										"rounded-full size-2",
										status.exitCode === 0 ? "bg-green-600" : "bg-red-600",
									)}
								/>
							</StandardTooltip>
						</div>
					)}
					{status?.status === "error" && (
						<div className="flex flex-row items-center gap-2 font-mono text-xs text-vscode-errorForeground">
							<StandardTooltip content={status.message ?? t("chat:commandExecution.malformedCommand")}>
								<div className="rounded-full size-2 bg-red-600" />
							</StandardTooltip>
						</div>
					)}
				</div>
				<div className=" flex flex-row items-center justify-between gap-2 px-1">
					<div className="flex flex-row items-center gap-1">
						{showRunningIndicator && (
							<div className="flex flex-row items-center gap-2 font-mono text-xs">
								{status.pid && <div className="whitespace-nowrap">(PID: {status.pid})</div>}
								<StandardTooltip content={t("chat:commandExecution.abort")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={() =>
											vscode.postMessage({
												type: "terminalOperation",
												terminalOperation: "abort",
											})
										}>
										<OctagonX className="size-4" />
									</Button>
								</StandardTooltip>
							</div>
						)}
						{output.length > 0 && (
							<Button variant="ghost" size="icon" onClick={() => setIsExpanded(!isExpanded)}>
								<ChevronDown
									className={cn(
										"size-4 transition-transform duration-300",
										isExpanded && "rotate-180",
									)}
								/>
							</Button>
						)}
					</div>
				</div>
			</div>

			<div className="bg-vscode-editor-background border border-vscode-border rounded-xs ml-6 mt-2">
				<div className="p-2">
					{terminalInfo && <TerminalInfo terminalInfo={terminalInfo} />}
					<CodeBlock source={command} language="shell" />
					<OutputContainer isExpanded={isExpanded} output={output} />
				</div>
				{command && command.trim() && (
					<CommandPatternSelector
						patterns={commandPatterns}
						allowedCommands={allowedCommands}
						deniedCommands={deniedCommands}
						onAllowPatternChange={handleAllowPatternChange}
						onDenyPatternChange={handleDenyPatternChange}
					/>
				)}
			</div>
		</>
	)
}

CommandExecution.displayName = "CommandExecution"

const providerLabels: Record<CommandTerminalInfo["provider"], string> = {
	vscode: "VS Code",
	execa: "Execa",
}

const TerminalInfo = ({ terminalInfo }: { terminalInfo: CommandTerminalInfo }) => {
	const { t } = useTranslation()
	const canFocusTerminal = terminalInfo.provider === "vscode" && terminalInfo.terminalId !== undefined

	return (
		<div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-vscode-descriptionForeground">
			<span>
				{terminalInfo.willReuseTerminal
					? t("chat:commandExecution.reuseTerminal")
					: t("chat:commandExecution.newTerminal")}
			</span>
			<span>{t("chat:commandExecution.terminalType", { type: providerLabels[terminalInfo.provider] })}</span>
			<span className="break-all">{t("chat:commandExecution.workingDirectory", { cwd: terminalInfo.cwd })}</span>
			{terminalInfo.terminalProfile && (
				<span>{t("chat:commandExecution.terminalProfile", { profile: terminalInfo.terminalProfile })}</span>
			)}
			{terminalInfo.terminalId !== undefined && (
				<span>{t("chat:commandExecution.terminalId", { id: terminalInfo.terminalId })}</span>
			)}
			{canFocusTerminal && (
				<Button
					variant="ghost"
					size="sm"
					className="h-6 px-1 text-xs"
					onClick={() =>
						vscode.postMessage({
							type: "terminalOperation",
							terminalOperation: "focus",
							terminalId: terminalInfo.terminalId,
						})
					}>
					<SquareArrowOutUpRight className="mr-1 size-3" />
					{t("chat:commandExecution.focusTerminal")}
				</Button>
			)}
		</div>
	)
}

const OutputContainerInternal = ({ isExpanded, output }: { isExpanded: boolean; output: string }) => (
	<div
		className={cn("overflow-hidden", {
			"max-h-0": !isExpanded,
			"max-h-[100%] mt-1 pt-1 border-t border-border/25": isExpanded,
		})}>
		{output.length > 0 && <TerminalOutput content={output} />}
	</div>
)

const OutputContainer = memo(OutputContainerInternal)

const parseCommandAndOutput = (
	text: string | undefined,
): { command: string; output: string; terminalInfo?: CommandTerminalInfo } => {
	if (!text) {
		return { command: "", output: "" }
	}

	const index = text.indexOf(COMMAND_OUTPUT_STRING)
	const rawCommand = index === -1 ? text : text.slice(0, index)
	const output = index === -1 ? "" : text.slice(index + COMMAND_OUTPUT_STRING.length)

	try {
		const parsed = JSON.parse(rawCommand) as { command?: unknown; terminalInfo?: CommandTerminalInfo }

		if (typeof parsed.command === "string") {
			return { command: parsed.command, output, terminalInfo: parsed.terminalInfo }
		}
	} catch {
		// Older command messages are plain text.
	}

	return { command: rawCommand, output }
}
