import type { ClineAskExternalToolResult } from "@roo-code/types"

import type { Task } from "../task/Task"

export const EXTERNAL_TOOL_RESULT_MAX_BYTES = 16 * 1024

const PREVIEW_MAX_CHARACTERS = 512

export type ExternalToolResultSource = ClineAskExternalToolResult["source"]

export interface ExternalToolResult {
	text: string
	images?: string[]
}

export interface ExternalToolResultApproval {
	approved: boolean
	byteSize: number
	result: ExternalToolResult
}

export function getExternalToolResultByteSize({ text, images = [] }: ExternalToolResult): number {
	return (
		Buffer.byteLength(text, "utf8") + images.reduce((total, image) => total + Buffer.byteLength(image, "utf8"), 0)
	)
}

export function createExternalToolResultDeniedMessage(source: ExternalToolResultSource, byteSize: number): string {
	return `[External ${source} result was not returned because its ${byteSize}-byte payload exceeded the ${EXTERNAL_TOOL_RESULT_MAX_BYTES}-byte limit and the user rejected it. Use a narrower query or request a smaller result.]`
}

export async function requestExternalToolResultApproval(
	task: Task,
	source: ExternalToolResultSource,
	name: string,
	result: ExternalToolResult,
): Promise<ExternalToolResultApproval> {
	const byteSize = getExternalToolResultByteSize(result)

	if (byteSize <= EXTERNAL_TOOL_RESULT_MAX_BYTES) {
		return { approved: true, byteSize, result }
	}

	const preview = result.text.slice(0, PREVIEW_MAX_CHARACTERS)
	const approvalPayload: ClineAskExternalToolResult = {
		source,
		name,
		byteSize,
		thresholdBytes: EXTERNAL_TOOL_RESULT_MAX_BYTES,
		preview,
		imageCount: result.images?.length ?? 0,
	}
	const { response } = await task.ask("external_tool_result", JSON.stringify(approvalPayload))

	return {
		approved: response === "yesButtonClicked",
		byteSize,
		result:
			response === "yesButtonClicked"
				? result
				: { text: createExternalToolResultDeniedMessage(source, byteSize) },
	}
}
