import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import type { ToolUse } from "../../shared/tools"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface WaitForUserConfirmationParams {
	reason: string
}

/**
 * Pauses the task until the user explicitly confirms that the agent should continue.
 *
 * This is intentionally distinct from a follow-up question: it presents one continue
 * action and returns any optional free-form feedback to the model as the tool result.
 */
export class WaitForUserConfirmationTool extends BaseTool<"wait_for_user_confirmation"> {
	readonly name = "wait_for_user_confirmation" as const

	async execute(params: WaitForUserConfirmationParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { reason } = params
		const { handleError, pushToolResult } = callbacks

		try {
			if (!reason) {
				task.consecutiveMistakeCount++
				task.recordToolError("wait_for_user_confirmation")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("wait_for_user_confirmation", "reason"))
				return
			}

			task.consecutiveMistakeCount = 0
			const { text, images } = await task.ask("wait_for_user_confirmation", reason, false)
			const safeText = text ?? ""
			await task.say("user_feedback", safeText, images)
			pushToolResult(formatResponse.toolResult(`<user_message>\n${safeText}\n</user_message>`, images))
		} catch (error) {
			await handleError("waiting for user confirmation", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"wait_for_user_confirmation">): Promise<void> {
		const reason = block.nativeArgs?.reason ?? block.params.reason
		await task.ask("wait_for_user_confirmation", reason ?? "", block.partial).catch(() => {})
	}
}

export const waitForUserConfirmationTool = new WaitForUserConfirmationTool()
