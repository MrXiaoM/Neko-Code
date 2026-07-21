/**
 * ReadFileTool - Codex-inspired file reading with indentation mode support.
 *
 * Supports two modes:
 * 1. Slice mode (default): Read contiguous lines with offset/limit
 * 2. Indentation mode: Extract semantic code blocks based on indentation hierarchy
 *
 * Also supports legacy format for backward compatibility:
 * - Legacy format: { files: [{ path: string, lineRanges?: [...] }] }
 */
import path from "path"
import * as fs from "fs/promises"
import { isBinaryFile } from "isbinaryfile"

import type { ReadFileParams, ReadFileMode, ReadFileToolParams, FileEntry, LineRange } from "@roo-code/types"
import { isLegacyReadFileParams, type ClineSayTool } from "@roo-code/types"

import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { getReadablePath } from "../../utils/path"
import { extractTextFromFile, addLineNumbers, getSupportedBinaryFormats } from "../../integrations/misc/extract-text"
import { readWithIndentation, readWithSlice } from "../../integrations/misc/indentation-reader"
import { DEFAULT_LINE_LIMIT } from "../prompts/tools/native-tools/read_file"
import type { ToolUse, PushToolResult } from "../../shared/tools"

import {
	DEFAULT_MAX_IMAGE_FILE_SIZE_MB,
	DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB,
	isSupportedImageFormat,
	validateImageForProcessing,
	processImageFile,
	ImageMemoryTracker,
} from "./helpers/imageHelpers"
import { BaseTool, ToolCallbacks } from "./BaseTool"

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Internal entry structure for tracking file read parameters.
 */
interface InternalFileEntry {
	path: string
	mode?: ReadFileMode
	offset?: number
	limit?: number
	anchor_line?: number
	max_levels?: number
	include_siblings?: boolean
	include_header?: boolean
	max_lines?: number
}

interface FileResult {
	path: string
	status: "approved" | "denied" | "blocked" | "error" | "pending"
	content?: string
	error?: string
	notice?: string
	nativeContent?: string
	imageDataUrl?: string
	feedbackText?: string
	feedbackImages?: string[]
	// Store the original entry for mode processing
	entry?: InternalFileEntry
}

// ─── Tool Implementation ──────────────────────────────────────────────────────

export class ReadFileTool extends BaseTool<"read_file"> {
	readonly name = "read_file" as const

	async execute(params: ReadFileToolParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		// Dispatch to legacy or new execution path based on format
		if (isLegacyReadFileParams(params)) {
			return this.executeLegacy(params.files, task, callbacks)
		}

		return this.executeNew(params, task, callbacks)
	}

	/**
	 * Execute new single-file format with slice/indentation mode support.
	 */
	private async executeNew(params: ReadFileParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult } = callbacks
		const modelInfo = task.api.getModel().info
		const filePath = params.path

		// Validate input
		if (!filePath) {
			task.consecutiveMistakeCount++
			task.recordToolError("read_file")
			const errorMsg = await task.sayAndCreateMissingParamError("read_file", "path")
			pushToolResult(`错误：${errorMsg}`)
			return
		}

		const supportsImages = modelInfo.supportsImages ?? false

		// Initialize file results tracking
		// Validate line number parameters (must be 1-indexed positive integers)
		if (params.offset !== undefined && params.offset < 1) {
			const errorMsg = `offset 必须是一个 1-indexed 的行号 (当前已取得 ${params.offset})。行号从 1 开始。`
			pushToolResult(`错误：${errorMsg}`)
			return
		}
		if (params.indentation?.anchor_line !== undefined && params.indentation.anchor_line < 1) {
			const errorMsg = `anchor_line 必须是一个 1-indexed 的行号 (当前已取得 ${params.indentation.anchor_line})。行号从 1 开始。`
			pushToolResult(`错误：${errorMsg}`)
			return
		}

		const fileEntry: InternalFileEntry = {
			path: filePath,
			mode: params.mode,
			offset: params.offset,
			limit: params.limit,
			anchor_line: params.indentation?.anchor_line,
			max_levels: params.indentation?.max_levels,
			include_siblings: params.indentation?.include_siblings,
			include_header: params.indentation?.include_header,
			max_lines: params.indentation?.max_lines,
		}

		const fileResults: FileResult[] = [
			{
				path: filePath,
				status: "pending" as const,
				entry: fileEntry,
			},
		]

		const updateFileResult = (filePath: string, updates: Partial<FileResult>) => {
			const index = fileResults.findIndex((result) => result.path === filePath)
			if (index !== -1) {
				fileResults[index] = { ...fileResults[index], ...updates }
			}
		}

		try {
			// Phase 1: Validate and filter files for approval
			const filesToApprove: FileResult[] = []

			for (const fileResult of fileResults) {
				const relPath = fileResult.path

				// RooIgnore validation
				const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)
				if (!accessAllowed) {
					await task.say("rooignore_error", relPath)
					const errorMsg = formatResponse.rooIgnoreError(relPath)
					updateFileResult(relPath, {
						status: "blocked",
						error: errorMsg,
						nativeContent: `文件：${relPath}\n错误：${errorMsg}`,
					})
					continue
				}

				filesToApprove.push(fileResult)
			}

			// Phase 2: Request user approval
			await this.requestApproval(task, filesToApprove, updateFileResult)

			// Phase 3: Process approved files
			const imageMemoryTracker = new ImageMemoryTracker()
			const state = await task.providerRef.deref()?.getState()
			const {
				maxImageFileSize = DEFAULT_MAX_IMAGE_FILE_SIZE_MB,
				maxTotalImageSize = DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB,
			} = state ?? {}

			for (const fileResult of fileResults) {
				if (fileResult.status !== "approved") continue

				const relPath = fileResult.path
				const fullPath = path.resolve(task.cwd, relPath)
				const entry = fileResult.entry!

				try {
					// Check if path is a directory
					const stats = await fs.stat(fullPath)
					if (stats.isDirectory()) {
						const errorMsg = `无法读取文件 '${relPath}'，因为它是一个目录。请使用 list_files 工具代替。`
						updateFileResult(relPath, {
							status: "error",
							error: errorMsg,
							nativeContent: `文件：${relPath}\n错误：${errorMsg}`,
						})
						await task.say("error", `读取文件 ${relPath} 失败：${errorMsg}`)
						continue
					}

					// Check for binary file
					const isBinary = await isBinaryFile(fullPath)

					if (isBinary) {
						await this.handleBinaryFile(
							task,
							relPath,
							fullPath,
							supportsImages,
							maxImageFileSize,
							maxTotalImageSize,
							imageMemoryTracker,
							updateFileResult,
						)
						continue
					}

					// Read text file content with lossy UTF-8 conversion
					// Reading as Buffer first allows graceful handling of non-UTF8 bytes
					// (they become U+FFFD replacement characters instead of throwing)
					const buffer = await fs.readFile(fullPath)
					const fileContent = buffer.toString("utf-8")
					const result = this.processTextFile(fileContent, entry)

					await task.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

					updateFileResult(relPath, {
						nativeContent: `文件：${relPath}\n${result}`,
					})
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : String(error)
					updateFileResult(relPath, {
						status: "error",
						error: `读取文件错误：${errorMsg}`,
						nativeContent: `文件：${relPath}\n错误：${errorMsg}`,
					})
					await task.say("error", `读取文件 ${relPath} 时发生错误：${errorMsg}`)
				}
			}

			// Phase 4: Build and return result
			const hasErrors = fileResults.some((r) => r.status === "error" || r.status === "blocked")
			if (hasErrors) {
				task.didToolFailInCurrentTurn = true
			}

			this.buildAndPushResult(task, fileResults, pushToolResult)
		} catch (error) {
			const relPath = filePath || "unknown"
			const errorMsg = error instanceof Error ? error.message : String(error)

			updateFileResult(relPath, {
				status: "error",
				error: `读取文件错误：${errorMsg}`,
				nativeContent: `文件：${relPath}\n错误：${errorMsg}`,
			})

			await task.say("error", `读取文件 ${relPath} 时发生错误：${errorMsg}`)
			task.didToolFailInCurrentTurn = true

			const errorResult = fileResults
				.filter((r) => r.nativeContent)
				.map((r) => r.nativeContent)
				.join("\n\n---\n\n")

			pushToolResult(errorResult || `错误：${errorMsg}`)
		}
	}

	/**
	 * Process a text file according to the requested mode.
	 */
	private processTextFile(content: string, entry: InternalFileEntry): string {
		const mode = entry.mode || "slice"

		if (mode === "indentation") {
			// Indentation mode: semantic block extraction
			// When anchor_line is not provided, default to offset (which defaults to 1)
			const anchorLine = entry.anchor_line ?? entry.offset ?? 1
			const result = readWithIndentation(content, {
				anchorLine,
				maxLevels: entry.max_levels,
				includeSiblings: entry.include_siblings,
				includeHeader: entry.include_header,
				limit: entry.limit ?? DEFAULT_LINE_LIMIT,
				maxLines: entry.max_lines,
			})

			let output = result.content

			if (result.wasTruncated && result.includedRanges.length > 0) {
				const [start, end] = result.includedRanges[0]
				const nextOffset = end + 1
				const effectiveLimit = entry.limit ?? DEFAULT_LINE_LIMIT
				// Put truncation warning at TOP (before content) to match @ mention format
				output = `重要提示：文件内容已截断。
	状态：正在显示总共 ${result.totalLines} 行中的第 ${start}-${end} 行。
	了解更多：使用 read_file 工具，带有参数 offset=${nextOffset} 和 limit=${effectiveLimit}。
	
	${result.content}`
			} else if (result.includedRanges.length > 0) {
				const rangeStr = result.includedRanges.map(([s, e]) => `${s}-${e}`).join(", ")
				output += `\n\n包含范围: ${rangeStr} (总共: ${result.totalLines} 行)`
			}

			return output
		}

		// Slice mode (default): simple offset/limit reading
		// NOTE: read_file offset is 1-based externally; convert to 0-based for readWithSlice.
		const offset1 = entry.offset ?? 1
		const offset0 = Math.max(0, offset1 - 1)
		const limit = entry.limit ?? DEFAULT_LINE_LIMIT

		const result = readWithSlice(content, offset0, limit)

		let output = result.content

		if (result.wasTruncated) {
			const startLine = offset1
			const endLine = offset1 + result.returnedLines - 1
			const nextOffset = endLine + 1
			// Put truncation warning at TOP (before content) to match @ mention format
			output = `重要提示：文件内容已截断。
状态：正在显示总共 ${result.totalLines} 行中的第 ${startLine}-${endLine} 行。
了解更多：使用 read_file 工具，带有参数 offset=${nextOffset} 和 limit=${limit}。
	
${result.content}`
		} else if (result.returnedLines === 0) {
			output = "提示：文件是空的"
		}

		return output
	}

	/**
	 * Handle binary file processing (images, PDF, DOCX, etc.).
	 */
	private async handleBinaryFile(
		task: Task,
		relPath: string,
		fullPath: string,
		supportsImages: boolean,
		maxImageFileSize: number,
		maxTotalImageSize: number,
		imageMemoryTracker: ImageMemoryTracker,
		updateFileResult: (path: string, updates: Partial<FileResult>) => void,
	): Promise<void> {
		const fileExtension = path.extname(relPath).toLowerCase()
		const supportedBinaryFormats = getSupportedBinaryFormats()

		// Handle image files
		if (isSupportedImageFormat(fileExtension)) {
			try {
				const validationResult = await validateImageForProcessing(
					fullPath,
					supportsImages,
					maxImageFileSize,
					maxTotalImageSize,
					imageMemoryTracker.getTotalMemoryUsed(),
				)

				if (!validationResult.isValid) {
					await task.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)
					updateFileResult(relPath, {
						nativeContent: `文件：${relPath}\n提示：${validationResult.notice}`,
					})
					return
				}

				const imageResult = await processImageFile(fullPath)
				imageMemoryTracker.addMemoryUsage(imageResult.sizeInMB)
				await task.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

				updateFileResult(relPath, {
					nativeContent: `文件：${relPath}\n提示：${imageResult.notice}`,
					imageDataUrl: imageResult.dataUrl,
				})
				return
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error)
				updateFileResult(relPath, {
					status: "error",
					error: `读取图片文件错误：${errorMsg}`,
					nativeContent: `文件：${relPath}\n错误：${errorMsg}`,
				})
				await task.say("error", `读取图片文件 ${relPath} 时出现错误：${errorMsg}`)
				return
			}
		}

		// Handle other supported binary formats (PDF, DOCX, etc.)
		if (supportedBinaryFormats && supportedBinaryFormats.includes(fileExtension)) {
			try {
				const content = await extractTextFromFile(fullPath)
				const numberedContent = addLineNumbers(content)
				const lineCount = content.split("\n").length

				await task.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

				updateFileResult(relPath, {
					nativeContent:
						lineCount > 0
							? `文件：${relPath}\n第 1-${lineCount} 行：\n${numberedContent}`
							: `文件：${relPath}\n提示：文件是空的`,
				})
				return
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error)
				updateFileResult(relPath, {
					status: "error",
					error: `无法提取文本：${errorMsg}`,
					nativeContent: `文件：${relPath}\n错误：${errorMsg}`,
				})
				await task.say("error", `无法从 ${relPath} 提取文本：${errorMsg}`)
				return
			}
		}

		// Unsupported binary format
		const fileFormat = fileExtension.slice(1) || "bin"
		updateFileResult(relPath, {
			notice: `二进制文件格式：${fileFormat}`,
			nativeContent: `文件：${relPath}\n二进制文件 (${fileFormat}) - 内容无法显示`,
		})
	}

	/**
	 * Request user approval for file reads.
	 */
	private async requestApproval(
		task: Task,
		filesToApprove: FileResult[],
		updateFileResult: (path: string, updates: Partial<FileResult>) => void,
	): Promise<void> {
		if (filesToApprove.length === 0) return

		if (filesToApprove.length > 1) {
			// Batch approval
			const batchFiles = filesToApprove.map((fileResult) => {
				const relPath = fileResult.path
				const fullPath = path.resolve(task.cwd, relPath)
				const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)
				const readablePath = getReadablePath(task.cwd, relPath)

				const lineSnippet = this.getLineSnippet(fileResult.entry!)
				const key = `${readablePath}${lineSnippet ? ` (${lineSnippet})` : ""}`

				return { path: readablePath, lineSnippet, isOutsideWorkspace, key, content: fullPath }
			})

			const completeMessage = JSON.stringify({ tool: "readFile", batchFiles } satisfies ClineSayTool)
			const { response, text, images } = await task.ask("tool", completeMessage, false)

			if (response === "yesButtonClicked") {
				if (text) await task.say("user_feedback", text, images)
				filesToApprove.forEach((fr) => {
					updateFileResult(fr.path, { status: "approved", feedbackText: text, feedbackImages: images })
				})
			} else if (response === "noButtonClicked") {
				if (text) await task.say("user_feedback", text, images)
				task.didRejectTool = true
				filesToApprove.forEach((fr) => {
					updateFileResult(fr.path, {
						status: "denied",
						nativeContent: `文件：${fr.path}\n状态：被用户拒绝`,
						feedbackText: text,
						feedbackImages: images,
					})
				})
			} else {
				// Individual permissions
				try {
					const individualPermissions = JSON.parse(text || "{}")
					let hasAnyDenial = false

					batchFiles.forEach((batchFile, index) => {
						const fileResult = filesToApprove[index]
						const approved = individualPermissions[batchFile.key] === true

						if (approved) {
							updateFileResult(fileResult.path, { status: "approved" })
						} else {
							hasAnyDenial = true
							updateFileResult(fileResult.path, {
								status: "denied",
								nativeContent: `文件：${fileResult.path}\n状态：被用户拒绝`,
							})
						}
					})

					if (hasAnyDenial) task.didRejectTool = true
				} catch {
					task.didRejectTool = true
					filesToApprove.forEach((fr) => {
						updateFileResult(fr.path, {
							status: "denied",
							nativeContent: `文件：${fr.path}\n状态：被用户拒绝`,
						})
					})
				}
			}
		} else {
			// Single file approval
			const fileResult = filesToApprove[0]
			const relPath = fileResult.path
			const fullPath = path.resolve(task.cwd, relPath)
			const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)
			const lineSnippet = this.getLineSnippet(fileResult.entry!)

			const startLine = this.getStartLine(fileResult.entry!)

			const completeMessage = JSON.stringify({
				tool: "readFile",
				path: getReadablePath(task.cwd, relPath),
				isOutsideWorkspace,
				content: fullPath,
				reason: lineSnippet,
				startLine,
			} satisfies ClineSayTool)

			const { response, text, images } = await task.ask("tool", completeMessage, false)

			if (response !== "yesButtonClicked") {
				if (text) await task.say("user_feedback", text, images)
				task.didRejectTool = true
				updateFileResult(relPath, {
					status: "denied",
					nativeContent: `文件：${relPath}\n状态：被用户拒绝`,
					feedbackText: text,
					feedbackImages: images,
				})
			} else {
				if (text) await task.say("user_feedback", text, images)
				updateFileResult(relPath, { status: "approved", feedbackText: text, feedbackImages: images })
			}
		}
	}

	/**
	 * Get the starting line number for navigation purposes.
	 */
	private getStartLine(entry: InternalFileEntry): number | undefined {
		if (entry.mode === "indentation") {
			// For indentation mode, always return the effective anchor line
			return entry.anchor_line ?? entry.offset ?? 1
		}
		const offset = entry.offset ?? 1
		return offset > 1 ? offset : undefined
	}

	/**
	 * Generate a human-readable line snippet for approval messages.
	 */
	private getLineSnippet(entry: InternalFileEntry): string {
		if (entry.mode === "indentation") {
			// Always show indentation mode with the effective anchor line
			const effectiveAnchor = entry.anchor_line ?? entry.offset ?? 1
			return `(位于 ${effectiveAnchor} 行的缩进模式)`
		}

		const limit = entry.limit ?? DEFAULT_LINE_LIMIT
		const offset1 = entry.offset ?? 1

		if (offset1 > 1) {
			return `(第 ${offset1}-${offset1 + limit - 1} 行)`
		}

		// Always show the line limit, even when using the default
		return `(直到 ${limit} 行)`
	}

	/**
	 * Build and push the final result to the tool output.
	 */
	private buildAndPushResult(task: Task, fileResults: FileResult[], pushToolResult: PushToolResult): void {
		const finalResult = fileResults
			.filter((r) => r.nativeContent)
			.map((r) => r.nativeContent)
			.join("\n\n---\n\n")

		const fileImageUrls = fileResults.filter((r) => r.imageDataUrl).map((r) => r.imageDataUrl as string)

		let statusMessage = ""
		let feedbackImages: string[] = []

		const deniedWithFeedback = fileResults.find((r) => r.status === "denied" && r.feedbackText)

		if (deniedWithFeedback?.feedbackText) {
			statusMessage = formatResponse.toolDeniedWithFeedback(deniedWithFeedback.feedbackText)
			feedbackImages = deniedWithFeedback.feedbackImages || []
		} else if (task.didRejectTool) {
			statusMessage = formatResponse.toolDenied()
		} else {
			const approvedWithFeedback = fileResults.find((r) => r.status === "approved" && r.feedbackText)
			if (approvedWithFeedback?.feedbackText) {
				statusMessage = formatResponse.toolApprovedWithFeedback(approvedWithFeedback.feedbackText)
				feedbackImages = approvedWithFeedback.feedbackImages || []
			}
		}

		const allImages = [...feedbackImages, ...fileImageUrls]
		const finalModelSupportsImages = task.api.getModel().info.supportsImages ?? false
		const imagesToInclude = finalModelSupportsImages ? allImages : []

		if (statusMessage || imagesToInclude.length > 0) {
			const result = formatResponse.toolResult(
				statusMessage || finalResult,
				imagesToInclude.length > 0 ? imagesToInclude : undefined,
			)

			if (typeof result === "string") {
				pushToolResult(statusMessage ? `${result}\n${finalResult}` : result)
			} else {
				if (statusMessage) {
					const textBlock = { type: "text" as const, text: finalResult }
					pushToolResult([...result, textBlock] as any)
				} else {
					pushToolResult(result as any)
				}
			}
		} else {
			pushToolResult(finalResult)
		}
	}

	getReadFileToolDescription(blockName: string, blockParams: { path?: string }): string
	getReadFileToolDescription(blockName: string, nativeArgs: ReadFileParams): string
	getReadFileToolDescription(blockName: string, second: unknown): string {
		// If native typed args were provided
		if (second && typeof second === "object" && "path" in second && typeof (second as any).path === "string") {
			return `[${blockName} for '${(second as any).path}']`
		}

		const blockParams = second as Record<string, unknown>
		if (blockParams?.path) {
			return `[${blockName} for '${blockParams.path}']`
		}
		return `[${blockName} with missing path]`
	}

	override async handlePartial(task: Task, block: ToolUse<"read_file">): Promise<void> {
		// Handle both legacy and new format for partial display
		let filePath = ""
		if (block.nativeArgs) {
			if (isLegacyReadFileParams(block.nativeArgs)) {
				// Legacy format - show first file
				filePath = block.nativeArgs.files[0]?.path ?? ""
			} else {
				filePath = block.nativeArgs.path ?? ""
			}
		}

		const fullPath = filePath ? path.resolve(task.cwd, filePath) : ""
		const sharedMessageProps: ClineSayTool = {
			tool: "readFile",
			path: getReadablePath(task.cwd, filePath),
			isOutsideWorkspace: filePath ? isPathOutsideWorkspace(fullPath) : false,
		}
		const partialMessage = JSON.stringify({
			...sharedMessageProps,
			content: undefined,
		} satisfies ClineSayTool)
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}

	/**
	 * Execute legacy multi-file format for backward compatibility.
	 * This handles the old format: { files: [{ path: string, lineRanges?: [...] }] }
	 */
	private async executeLegacy(fileEntries: FileEntry[], task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult } = callbacks
		const modelInfo = task.api.getModel().info

		if (!fileEntries || fileEntries.length === 0) {
			task.consecutiveMistakeCount++
			task.recordToolError("read_file")
			const errorMsg = await task.sayAndCreateMissingParamError("read_file", "files")
			pushToolResult(`错误：${errorMsg}`)
			return
		}

		const supportsImages = modelInfo.supportsImages ?? false

		// Process each file sequentially (legacy behavior)
		const results: string[] = []

		for (const entry of fileEntries) {
			const relPath = entry.path
			const fullPath = path.resolve(task.cwd, relPath)

			// RooIgnore validation
			const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)
			if (!accessAllowed) {
				await task.say("rooignore_error", relPath)
				const errorMsg = formatResponse.rooIgnoreError(relPath)
				results.push(`文件：${relPath}\n错误：${errorMsg}`)
				// Mirror the native path: a blocked file marks the tool turn as failed.
				task.didToolFailInCurrentTurn = true
				continue
			}

			// Request approval for single file
			const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)
			let lineSnippet = ""
			if (entry.lineRanges && entry.lineRanges.length > 0) {
				const ranges = entry.lineRanges.map((range: LineRange) => `(lines ${range.start}-${range.end})`)
				lineSnippet = ranges.join(", ")
			}

			const completeMessage = JSON.stringify({
				tool: "readFile",
				path: getReadablePath(task.cwd, relPath),
				isOutsideWorkspace,
				content: fullPath,
				reason: lineSnippet || undefined,
			} satisfies ClineSayTool)

			const { response, text, images } = await task.ask("tool", completeMessage, false)

			if (response !== "yesButtonClicked") {
				if (text) await task.say("user_feedback", text, images)
				task.didRejectTool = true
				results.push(`文件：${relPath}\n状态：被用户拒绝`)
				continue
			}

			if (text) await task.say("user_feedback", text, images)

			try {
				// Check if the path is a directory
				const stats = await fs.stat(fullPath)
				if (stats.isDirectory()) {
					const errorMsg = `无法读取 '${relPath}'，因为它是一个目录。`
					results.push(`文件：${relPath}\n错误：${errorMsg}`)
					await task.say("error", `读取文件 ${relPath} 时出现一个错误：${errorMsg}`)
					// Mirror the native path: a failed read marks the tool turn as failed.
					task.didToolFailInCurrentTurn = true
					continue
				}

				const isBinary = await isBinaryFile(fullPath).catch(() => false)

				if (isBinary) {
					// Handle binary files (images)
					const fileExtension = path.extname(relPath).toLowerCase()
					if (supportsImages && isSupportedImageFormat(fileExtension)) {
						const state = await task.providerRef.deref()?.getState()
						const {
							maxImageFileSize = DEFAULT_MAX_IMAGE_FILE_SIZE_MB,
							maxTotalImageSize = DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB,
						} = state ?? {}
						const validation = await validateImageForProcessing(
							fullPath,
							supportsImages,
							maxImageFileSize,
							maxTotalImageSize,
							0, // Legacy path doesn't track cumulative memory
						)
						if (!validation.isValid) {
							results.push(`文件：${relPath}\n提示：${validation.notice ?? "图片校验失败"}`)
							continue
						}
						const imageResult = await processImageFile(fullPath)
						if (imageResult) {
							results.push(`文件：${relPath}\n[图片文件 - 内容已由视觉模型处理]`)
						}
					} else {
						results.push(`文件：${relPath}\n错误：无法读取二进制文件`)
					}
					continue
				}

				// Read text file
				const rawContent = await fs.readFile(fullPath, "utf8")

				// Handle line ranges if specified
				let content: string
				if (entry.lineRanges && entry.lineRanges.length > 0) {
					const lines = rawContent.split("\n")
					const selectedLines: string[] = []

					for (const range of entry.lineRanges) {
						// Convert to 0-based index, ranges are 1-based inclusive
						const startIdx = Math.max(0, range.start - 1)
						const endIdx = Math.min(lines.length - 1, range.end - 1)

						for (let i = startIdx; i <= endIdx; i++) {
							selectedLines.push(`${i + 1} | ${lines[i]}`)
						}
					}
					content = selectedLines.join("\n")
				} else {
					// Read with default limits using slice mode
					const result = readWithSlice(rawContent, 0, DEFAULT_LINE_LIMIT)
					content = result.content
					if (result.wasTruncated) {
						content += `\n\n[文件已截断: 正在显示总共 ${result.totalLines} 行中的 ${result.returnedLines} 行]`
					}
				}

				results.push(`文件：${relPath}\n${content}`)

				// Track file in context
				await task.fileContextTracker.trackFileContext(relPath, "read_tool")
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error)
				results.push(`文件：${relPath}\n错误：${errorMsg}`)
				await task.say("error", `读取文件 ${relPath} 时发生错误：${errorMsg}`)
				// Mirror the native path: a failed read marks the tool turn as failed.
				task.didToolFailInCurrentTurn = true
			}
		}

		// Push combined results
		pushToolResult(results.join("\n\n---\n\n"))
	}
}

export const readFileTool = new ReadFileTool()
