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

interface SearchReplaceParams {
	file_path: string
	old_string: string
	new_string: string
}

export class SearchReplaceTool extends BaseTool<"search_replace"> {
	readonly name = "search_replace" as const

	async execute(params: SearchReplaceParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { file_path, old_string, new_string } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			// Validate required parameters
			if (!file_path) {
				task.consecutiveMistakeCount++
				task.recordToolError("search_replace")
				pushToolResult(await task.sayAndCreateMissingParamError("search_replace", "file_path"))
				return
			}

			if (!old_string) {
				task.consecutiveMistakeCount++
				task.recordToolError("search_replace")
				pushToolResult(await task.sayAndCreateMissingParamError("search_replace", "old_string"))
				return
			}

			if (new_string === undefined) {
				task.consecutiveMistakeCount++
				task.recordToolError("search_replace")
				pushToolResult(await task.sayAndCreateMissingParamError("search_replace", "new_string"))
				return
			}

			// Validate that old_string and new_string are different
			if (old_string === new_string) {
				task.consecutiveMistakeCount++
				task.recordToolError("search_replace")
				pushToolResult(formatResponse.toolError("参数 'old_string' 和 'new_string' 必须不相同。"))
				return
			}

			// Determine relative path - file_path can be absolute or relative
			let relPath: string
			if (path.isAbsolute(file_path)) {
				relPath = path.relative(task.cwd, file_path)
			} else {
				relPath = file_path
			}

			const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)

			if (!accessAllowed) {
				await task.say("rooignore_error", relPath)
				pushToolResult(formatResponse.rooIgnoreError(relPath))
				return
			}

			// Check if file is write-protected
			const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false

			const absolutePath = path.resolve(task.cwd, relPath)

			const fileExists = await fileExistsAtPath(absolutePath)
			if (!fileExists) {
				task.consecutiveMistakeCount++
				task.recordToolError("search_replace")
				const errorMessage = `文件不存在：${relPath}。无法对不存在的文件执行搜索和替换操作。`
				await task.say("error", errorMessage)
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			let fileContent: string
			try {
				fileContent = await fs.readFile(absolutePath, "utf8")
				// Normalize line endings to LF for consistent matching
				fileContent = fileContent.replace(/\r\n/g, "\n")
			} catch (error) {
				task.consecutiveMistakeCount++
				task.recordToolError("search_replace")
				const errorMessage = `无法读取文件 '${relPath}'。请验证文件权限并重试。`
				await task.say("error", errorMessage)
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			// Normalize line endings in search/replace strings to match file content
			const normalizedOldString = old_string.replace(/\r\n/g, "\n")
			const normalizedNewString = new_string.replace(/\r\n/g, "\n")

			// Check for exact match (literal string, not regex)
			const matchCount = fileContent.split(normalizedOldString).length - 1

			if (matchCount === 0) {
				task.consecutiveMistakeCount++
				task.recordToolError("search_replace", "no_match")
				pushToolResult(
					formatResponse.toolError(
						`指定的 'old_string' 无法进行匹配。请确保它完全匹配文件内容，包括空白符和缩进。`,
					),
				)
				return
			}

			if (matchCount > 1) {
				task.consecutiveMistakeCount++
				task.recordToolError("search_replace", "multiple_matches")
				pushToolResult(
					formatResponse.toolError(
						`使用指定的 'old_string' 找到了 ${matchCount} 个匹配结果。这个工具每次只能替换【1】个结果。请提供更多上下文 (前后的 3-5 行内容) 以唯一化你要更改的内容。`,
					),
				)
				return
			}

			// Apply the single replacement
			const newContent = fileContent.replace(normalizedOldString, normalizedNewString)

			// Check if any changes were made
			if (newContent === fileContent) {
				pushToolResult(`对于文件 '${relPath}' 来说，没有需要的变更`)
				return
			}

			task.consecutiveMistakeCount = 0

			// Initialize diff view
			task.diffViewProvider.editType = "modify"
			task.diffViewProvider.originalContent = fileContent

			// Generate and validate diff
			const diff = formatResponse.createPrettyPatch(relPath, fileContent, newContent)
			if (!diff) {
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

			const sanitizedDiff = sanitizeUnifiedDiff(diff)
			const diffStats = computeDiffStats(sanitizedDiff) || undefined
			const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

			const sharedMessageProps: ClineSayTool = {
				tool: "appliedDiff",
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
				await task.diffViewProvider.saveDirectly(relPath, newContent, false, diagnosticsEnabled, writeDelayMs)
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
			const message = await task.diffViewProvider.pushToolWriteResult(task, task.cwd, false)
			pushToolResult(message)

			await task.diffViewProvider.reset()
			this.resetPartialState()

			// Process any queued messages after file edit completes
			task.processQueuedMessages()
		} catch (error) {
			await handleError("search and replace", error as Error)
			await task.diffViewProvider.reset()
			this.resetPartialState()
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"search_replace">): Promise<void> {
		const filePath: string | undefined = block.params.file_path
		const oldString: string | undefined = block.params.old_string

		// Wait for path to stabilize before showing UI (prevents truncated paths)
		if (!this.hasPathStabilized(filePath)) {
			return
		}

		let operationPreview: string | undefined
		if (oldString) {
			// Show a preview of what will be replaced
			const preview = oldString.length > 50 ? oldString.substring(0, 50) + "..." : oldString
			operationPreview = `正在替换: "${preview}"`
		}

		// Determine relative path for display (filePath is guaranteed non-null after hasPathStabilized)
		let relPath = filePath!
		if (path.isAbsolute(relPath)) {
			relPath = path.relative(task.cwd, relPath)
		}

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

export const searchReplaceTool = new SearchReplaceTool()
