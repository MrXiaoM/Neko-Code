import fs from "fs/promises"
import path from "path"

import { type ClineSayTool, DEFAULT_WRITE_DELAY_MS } from "@roo-code/types"

import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { fileExistsAtPath } from "../../utils/fs"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { sanitizeUnifiedDiff, computeDiffStats } from "../diff/stats"
import type { ToolUse } from "../../shared/tools"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface EditFileParams {
	file_path: string
	old_string: string
	new_string: string
	expected_replacements?: number
}

type LineEnding = "\r\n" | "\n"

/**
 * Count occurrences of a substring in a string.
 * @param str The string to search in
 * @param substr The substring to count
 * @returns Number of non-overlapping occurrences
 */
function countOccurrences(str: string, substr: string): number {
	if (substr === "") return 0
	let count = 0
	let pos = str.indexOf(substr)
	while (pos !== -1) {
		count++
		pos = str.indexOf(substr, pos + substr.length)
	}
	return count
}

/**
 * Safely replace all occurrences of a literal string, handling $ escape sequences.
 * Standard String.replaceAll treats $ specially in the replacement string.
 * This function ensures literal replacement.
 *
 * @param str The original string
 * @param oldString The string to replace
 * @param newString The replacement string
 * @returns The string with all occurrences replaced
 */
function safeLiteralReplace(str: string, oldString: string, newString: string): string {
	if (oldString === "" || !str.includes(oldString)) {
		return str
	}

	// If newString doesn't contain $, we can use replaceAll directly
	if (!newString.includes("$")) {
		return str.replaceAll(oldString, newString)
	}

	// Escape $ to prevent ECMAScript GetSubstitution issues
	// $$ becomes a single $ in the output, so we double-escape
	const escapedNewString = newString.replaceAll("$", "$$$$")
	return str.replaceAll(oldString, escapedNewString)
}

function detectLineEnding(content: string): LineEnding {
	return content.includes("\r\n") ? "\r\n" : "\n"
}

function normalizeToLF(content: string): string {
	return content.replace(/\r\n/g, "\n")
}

function restoreLineEnding(contentLF: string, eol: LineEnding): string {
	if (eol === "\n") return contentLF
	return contentLF.replace(/\n/g, "\r\n")
}

function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildWhitespaceTolerantRegex(oldLF: string): RegExp {
	if (oldLF === "") {
		// Never match empty string
		return new RegExp("(?!)", "g")
	}

	const parts = oldLF.match(/(\s+|\S+)/g) ?? []
	const whitespacePatternForRun = (run: string): string => {
		// If the whitespace run includes a newline, allow matching any whitespace (including newlines)
		// to tolerate wrapping changes across lines.
		if (run.includes("\n")) {
			return "\\s+"
		}

		// Otherwise, limit matching to horizontal whitespace so we don't accidentally consume
		// line breaks that precede indentation.
		return "[\\t ]+"
	}

	const pattern = parts
		.map((part) => {
			if (/^\s+$/.test(part)) {
				return whitespacePatternForRun(part)
			}
			return escapeRegExp(part)
		})
		.join("")

	return new RegExp(pattern, "g")
}

function buildTokenRegex(oldLF: string): RegExp {
	const tokens = oldLF.split(/\s+/).filter(Boolean)
	if (tokens.length === 0) {
		return new RegExp("(?!)", "g")
	}

	const pattern = tokens.map(escapeRegExp).join("\\s+")
	return new RegExp(pattern, "g")
}

function countRegexMatches(content: string, regex: RegExp): number {
	const stable = new RegExp(regex.source, regex.flags)
	return Array.from(content.matchAll(stable)).length
}

export class EditFileTool extends BaseTool<"edit_file"> {
	readonly name = "edit_file" as const

	private didSendPartialToolAsk = false
	private partialToolAskRelPath: string | undefined

	async execute(params: EditFileParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		// Coerce old_string/new_string to handle malformed native tool calls where they could be non-strings.
		// In native mode, malformed calls can pass numbers/objects; normalize those to "" to avoid later crashes.
		const file_path = params.file_path
		const old_string = typeof params.old_string === "string" ? params.old_string : ""
		const new_string = typeof params.new_string === "string" ? params.new_string : ""
		const expected_replacements = params.expected_replacements ?? 1
		const { askApproval, handleError, pushToolResult } = callbacks
		let relPathForErrorHandling: string | undefined
		let operationPreviewForErrorHandling: string | undefined

		const finalizePartialToolAskIfNeeded = async (relPath: string): Promise<void> => {
			if (!this.didSendPartialToolAsk) {
				return
			}

			if (this.partialToolAskRelPath && this.partialToolAskRelPath !== relPath) {
				return
			}

			const absolutePath = path.resolve(task.cwd, relPath)
			const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

			const sharedMessageProps: ClineSayTool = {
				tool: "appliedDiff",
				path: getReadablePath(task.cwd, relPath),
				diff: operationPreviewForErrorHandling,
				isOutsideWorkspace,
			}

			// Finalize the existing partial tool ask row so the UI doesn't get stuck in a spinner state.
			await task.ask("tool", JSON.stringify(sharedMessageProps), false).catch(() => {})
		}

		const recordFailureForPathAndMaybeEscalate = async (relPath: string, formattedError: string): Promise<void> => {
			const currentCount = (task.consecutiveMistakeCountForEditFile.get(relPath) || 0) + 1
			task.consecutiveMistakeCountForEditFile.set(relPath, currentCount)

			if (currentCount >= 2) {
				await task.say("diff_error", formattedError)
			}
		}

		try {
			// Validate required parameters
			if (!file_path) {
				task.consecutiveMistakeCount++
				task.recordToolError("edit_file")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("edit_file", "file_path"))
				return
			}

			// Determine relative path - file_path can be absolute or relative
			let relPath: string
			if (path.isAbsolute(file_path)) {
				relPath = path.relative(task.cwd, file_path)
			} else {
				relPath = file_path
			}
			relPathForErrorHandling = relPath

			operationPreviewForErrorHandling =
				old_string === ""
					? "正在创建新文件"
					: (() => {
							const preview = old_string.length > 50 ? old_string.substring(0, 50) + "..." : old_string
							return `正在替换："${preview}"`
						})()

			const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)

			if (!accessAllowed) {
				// Finalize the partial tool preview before emitting any say() messages.
				await finalizePartialToolAskIfNeeded(relPath)
				task.didToolFailInCurrentTurn = true
				await task.say("rooignore_error", relPath)
				pushToolResult(formatResponse.rooIgnoreError(relPath))
				return
			}

			// Check if file is write-protected
			const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false

			const absolutePath = path.resolve(task.cwd, relPath)
			const fileExists = await fileExistsAtPath(absolutePath)

			let currentContent: string | null = null
			let currentContentLF: string | null = null
			let originalEol: LineEnding = "\n"
			let isNewFile = false

			// Read file or determine if creating new
			if (fileExists) {
				try {
					currentContent = await fs.readFile(absolutePath, "utf8")
					originalEol = detectLineEnding(currentContent)
					// Normalize line endings to LF for matching
					currentContentLF = normalizeToLF(currentContent)
				} catch (error) {
					task.consecutiveMistakeCount++
					task.didToolFailInCurrentTurn = true
					const errorDetails = error instanceof Error ? error.message : String(error)
					const formattedError = `无法读取文件：${absolutePath}

<error_details>
读取错误：${errorDetails}

恢复建议：
1. 验证文件是否存在且是否可读
2. 检查文件权限
3. 如果文件可能已被更改，使用 read_file 来确认它的当前内容
</error_details>`
					await finalizePartialToolAskIfNeeded(relPath)
					await recordFailureForPathAndMaybeEscalate(relPath, formattedError)
					task.recordToolError("edit_file", formattedError)
					pushToolResult(formattedError)
					return
				}

				// Check if trying to create a file that already exists
				if (old_string === "") {
					task.consecutiveMistakeCount++
					task.didToolFailInCurrentTurn = true
					const formattedError = `文件已经存在：${absolutePath}

<error_details>
你提供了空的 old_string，这表明了需要创建文件，但目标文件已经存在了。

恢复建议：
1. 修改已经存在的文件，提供非空的 old_string 以匹配当前文件内容
2. 使用 read_file 来确认要匹配的具体文本
3. 如果你要重写整个文件，请使用 write_to_file 代替
</error_details>`
					await finalizePartialToolAskIfNeeded(relPath)
					await recordFailureForPathAndMaybeEscalate(relPath, formattedError)
					task.recordToolError("edit_file", formattedError)
					pushToolResult(formattedError)
					return
				}
			} else {
				// File doesn't exist
				if (old_string === "") {
					// Creating a new file
					isNewFile = true
				} else {
					// Trying to replace in non-existent file
					task.consecutiveMistakeCount++
					task.didToolFailInCurrentTurn = true
					const formattedError = `路径指定的文件不存在：${absolutePath}

<error_details>
找不到指定的文件，所以替换操作无法被执行。

恢复建议：
1. 验证文件路径是否正确
2. 如果你要创建一个新文件，请设置 old_string 为空字符串
3. 使用 list_files 或 read_file 来确认路径是否正确
</error_details>`
					// Match apply_diff behavior: surface missing file via the generic error channel.
					await finalizePartialToolAskIfNeeded(relPath)
					await task.say("error", formattedError)
					await recordFailureForPathAndMaybeEscalate(relPath, formattedError)
					task.recordToolError("edit_file", formattedError)
					pushToolResult(formattedError)
					return
				}
			}

			const oldLF = normalizeToLF(old_string)
			const newLF = normalizeToLF(new_string)
			const expectedReplacements = Math.max(1, expected_replacements)

			// Validate replacement operation
			if (!isNewFile && currentContentLF !== null) {
				// Validate that old_string and new_string are different (normalized for EOL)
				if (oldLF === newLF) {
					task.consecutiveMistakeCount++
					task.didToolFailInCurrentTurn = true
					const formattedError = `需要编辑的文件没有变更：${absolutePath}

<error_details>
提供的 old_string 和 new_string（在归一化行号之后）是相同的，所以没有产生变更。

恢复建议：
1. 更新 new_string 到要替换为的文本
2. 如果你仅仅需要验证文件状态，请使用 read_file 代替
</error_details>`
					await finalizePartialToolAskIfNeeded(relPath)
					await recordFailureForPathAndMaybeEscalate(relPath, formattedError)
					task.recordToolError("edit_file", formattedError)
					pushToolResult(formattedError)
					return
				}

				const wsRegex = buildWhitespaceTolerantRegex(oldLF)
				const tokenRegex = buildTokenRegex(oldLF)

				// Strategy 1: exact literal match
				const exactOccurrences = countOccurrences(currentContentLF, oldLF)
				if (exactOccurrences === expectedReplacements) {
					// Apply literal replacement on LF-normalized content
					currentContentLF = safeLiteralReplace(currentContentLF, oldLF, newLF)
				} else {
					// Strategy 2: whitespace-tolerant regex
					const wsOccurrences = countRegexMatches(currentContentLF, wsRegex)
					if (wsOccurrences === expectedReplacements) {
						currentContentLF = currentContentLF.replace(wsRegex, () => newLF)
					} else {
						// Strategy 3: token-based regex
						const tokenOccurrences = countRegexMatches(currentContentLF, tokenRegex)
						if (tokenOccurrences === expectedReplacements) {
							currentContentLF = currentContentLF.replace(tokenRegex, () => newLF)
						} else {
							// Error reporting
							const anyMatches = exactOccurrences > 0 || wsOccurrences > 0 || tokenOccurrences > 0
							if (!anyMatches) {
								task.consecutiveMistakeCount++
								task.didToolFailInCurrentTurn = true
								const formattedError = `文件中没有匹配的文本：${absolutePath}

<error_details>
提供的 old_string 无法使用精确的、容忍空白符、或基于 token 的任意方式匹配。

恢复建议：
1. 使用 read_file 来确认当前文件内容
2. 确保 old_string 完全精确匹配 (包括空白符、缩进，以及行尾)
3. 在 old_string 中提供更多周围的内容，以确保匹配区域唯一
4. 如果文件在你构造 old_string 后发生更改，请重新读取并重试
</error_details>`
								await finalizePartialToolAskIfNeeded(relPath)
								await recordFailureForPathAndMaybeEscalate(relPath, formattedError)
								task.recordToolError("edit_file", formattedError)
								pushToolResult(formattedError)
								return
							}

							// If exact matching finds occurrences but doesn't match expected, keep the existing message
							if (exactOccurrences > 0) {
								task.consecutiveMistakeCount++
								task.didToolFailInCurrentTurn = true
								const formattedError = `文件中的发生次数不匹配：${absolutePath}

<error_details>
期望发生 ${expectedReplacements} 次匹配，但实际匹配了 ${exactOccurrences} 次。

恢复建议：
1. 提供更具体的 old_string 以便于精确匹配一次
2. 如果你要替换所有发生的匹配，设置 expected_replacements 为 ${exactOccurrences}
3. 使用 read_file 来确认精确的文本以及匹配次数
</error_details>`
								await finalizePartialToolAskIfNeeded(relPath)
								await recordFailureForPathAndMaybeEscalate(relPath, formattedError)
								task.recordToolError("edit_file", formattedError)
								pushToolResult(formattedError)
								return
							}

							task.consecutiveMistakeCount++
							task.didToolFailInCurrentTurn = true
							const formattedError = `文件中的发生次数不匹配：${absolutePath}

<error_details>
期望发生 ${expectedReplacements} 次匹配，但实际匹配了 ${wsOccurrences} 次 (空白符容忍) 以及 ${tokenOccurrences} 次 (基于 token)。

恢复建议：
1. 在 old_string 中提供更多周围的上下文，使得匹配唯一
2. 如果需要多次替换，调整 expected_replacements 为需要的次数
3. 使用 read_file 来确认当前文件内容，并重新改善匹配内容
</error_details>`
							await finalizePartialToolAskIfNeeded(relPath)
							await recordFailureForPathAndMaybeEscalate(relPath, formattedError)
							task.recordToolError("edit_file", formattedError)
							pushToolResult(formattedError)
							return
						}
					}
				}
			}

			// Apply the replacement
			const newContent = isNewFile
				? new_string
				: restoreLineEnding(currentContentLF ?? currentContent ?? "", originalEol)

			// Check if any changes were made
			if (!isNewFile && newContent === currentContent) {
				if (relPathForErrorHandling) {
					task.consecutiveMistakeCount = 0
					task.consecutiveMistakeCountForEditFile.delete(relPathForErrorHandling)
				}
				await finalizePartialToolAskIfNeeded(relPath)
				pushToolResult(`对于文件 '${relPath}' 来说，没有需要的变更`)
				return
			}

			task.consecutiveMistakeCount = 0
			task.consecutiveMistakeCountForEditFile.delete(relPath)

			// Initialize diff view
			task.diffViewProvider.editType = isNewFile ? "create" : "modify"
			task.diffViewProvider.originalContent = currentContent || ""

			// Generate and validate diff
			const diff = formatResponse.createPrettyPatch(relPath, currentContent || "", newContent)
			if (!diff && !isNewFile) {
				task.consecutiveMistakeCount = 0
				task.consecutiveMistakeCountForEditFile.delete(relPath)
				await finalizePartialToolAskIfNeeded(relPath)
				pushToolResult(`对于文件 '${relPath}' 来说，没有需要的变更`)
				await task.diffViewProvider.reset()
				return
			}

			// Check if preventFocusDisruption experiment is enabled
			const provider = task.providerRef.deref()
			const state = await provider?.getState()
			const diagnosticsEnabled = state?.diagnosticsEnabled ?? true
			const writeDelayMs = state?.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS
			const isPreventFocusDisruptionEnabled = experiments.isEnabled(
				state?.experiments ?? {},
				EXPERIMENT_IDS.PREVENT_FOCUS_DISRUPTION,
			)

			const sanitizedDiff = sanitizeUnifiedDiff(diff || "")
			const diffStats = computeDiffStats(sanitizedDiff) || undefined
			const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

			const sharedMessageProps: ClineSayTool = {
				tool: isNewFile ? "newFileCreated" : "appliedDiff",
				path: getReadablePath(task.cwd, relPath),
				diff: sanitizedDiff,
				isOutsideWorkspace,
			}

			const completeMessage = JSON.stringify({
				...sharedMessageProps,
				content: sanitizedDiff,
				isProtected: isWriteProtected,
				diffStats,
			} satisfies ClineSayTool)

			// Show diff view if focus disruption prevention is disabled
			if (!isPreventFocusDisruptionEnabled) {
				await task.diffViewProvider.open(relPath)
				await task.diffViewProvider.update(newContent, true)
				task.diffViewProvider.scrollToFirstDiff()
			}

			const didApprove = await askApproval("tool", completeMessage, undefined, isWriteProtected)

			if (!didApprove) {
				// Revert changes if diff view was shown
				if (!isPreventFocusDisruptionEnabled) {
					await task.diffViewProvider.revertChanges()
				}
				pushToolResult("此变更已被用户拒绝。")
				await task.diffViewProvider.reset()
				return
			}

			// Save the changes
			if (isPreventFocusDisruptionEnabled) {
				// Direct file write without diff view or opening the file
				await task.diffViewProvider.saveDirectly(
					relPath,
					newContent,
					isNewFile,
					diagnosticsEnabled,
					writeDelayMs,
				)
			} else {
				// Call saveChanges to update the DiffViewProvider properties
				await task.diffViewProvider.saveChanges(diagnosticsEnabled, writeDelayMs)
			}

			// Track file edit operation
			if (relPath) {
				await task.fileContextTracker.trackFileContext(relPath, "roo_edited" as RecordSource)
			}

			task.didEditFile = true

			// Get the formatted response message
			const replacementInfo =
				!isNewFile && expected_replacements > 1 ? ` (${expected_replacements} replacements)` : ""
			const message = await task.diffViewProvider.pushToolWriteResult(task, task.cwd, isNewFile)

			pushToolResult(message + replacementInfo)

			await task.diffViewProvider.reset()
			this.resetPartialState()

			// Process any queued messages after file edit completes
			task.processQueuedMessages()
		} catch (error) {
			if (relPathForErrorHandling) {
				await finalizePartialToolAskIfNeeded(relPathForErrorHandling)
			}
			await handleError("edit_file", error as Error)
			await task.diffViewProvider.reset()
			task.didToolFailInCurrentTurn = true
		} finally {
			this.didSendPartialToolAsk = false
			this.partialToolAskRelPath = undefined
			this.resetPartialState()
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"edit_file">): Promise<void> {
		const filePath: string | undefined = block.params.file_path
		const oldString: string | undefined = block.params.old_string

		// Wait for path to stabilize before showing UI (prevents truncated paths)
		if (!this.hasPathStabilized(filePath)) {
			return
		}

		let operationPreview: string | undefined
		if (oldString !== undefined) {
			if (oldString === "") {
				operationPreview = "正在创建新文件"
			} else {
				const preview = oldString.length > 50 ? oldString.substring(0, 50) + "..." : oldString
				operationPreview = `正在替换: "${preview}"`
			}
		}

		// Determine relative path for display (filePath is guaranteed non-null after hasPathStabilized)
		let relPath = filePath!
		if (path.isAbsolute(relPath)) {
			relPath = path.relative(task.cwd, relPath)
		}
		this.didSendPartialToolAsk = true
		this.partialToolAskRelPath = relPath

		const absolutePath = path.resolve(task.cwd, relPath)
		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

		const sharedMessageProps: ClineSayTool = {
			tool: "appliedDiff",
			path: getReadablePath(task.cwd, relPath),
			diff: operationPreview,
			isOutsideWorkspace,
		}

		await task.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
	}
}

export const editFileTool = new EditFileTool()
