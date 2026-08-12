import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Task } from "../../task/Task"
import type { ToolUse } from "../../../shared/tools"
import type { ToolCallbacks } from "../BaseTool"
import { WaitForUserConfirmationTool } from "../WaitForUserConfirmationTool"
import { formatResponse } from "../../prompts/responses"

describe("WaitForUserConfirmationTool", () => {
	let tool: WaitForUserConfirmationTool
	let mockTask: Task
	let mockCallbacks: ToolCallbacks

	beforeEach(() => {
		vi.clearAllMocks()
		tool = new WaitForUserConfirmationTool()
		mockTask = {
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			didToolFailInCurrentTurn: false,
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing parameter error"),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "继续等待", images: [] }),
			say: vi.fn().mockResolvedValue(undefined),
		} as unknown as Task
		mockCallbacks = {
			askApproval: vi.fn(),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
	})

	it("rejects a missing reason", async () => {
		await tool.execute({ reason: "" }, mockTask, mockCallbacks)

		expect(mockTask.consecutiveMistakeCount).toBe(1)
		expect(mockTask.recordToolError).toHaveBeenCalledWith("wait_for_user_confirmation")
		expect(mockTask.didToolFailInCurrentTurn).toBe(true)
		expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("wait_for_user_confirmation", "reason")
		expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith("Missing parameter error")
	})

	it("waits for explicit confirmation without using approval automation", async () => {
		await tool.execute({ reason: "测试仍在运行，需要等待完成。" }, mockTask, mockCallbacks)

		expect(mockTask.ask).toHaveBeenCalledWith("wait_for_user_confirmation", "测试仍在运行，需要等待完成。", false)
		expect(mockCallbacks.askApproval).not.toHaveBeenCalled()
	})

	it("returns optional user feedback as the tool result", async () => {
		const images = ["data:image/png;base64,iVBORw0KGgo="]
		;(mockTask.ask as ReturnType<typeof vi.fn>).mockResolvedValue({
			response: "yesButtonClicked",
			text: "继续等待，并在完成后汇报。",
			images,
		})

		await tool.execute({ reason: "命令仍在后台运行。" }, mockTask, mockCallbacks)

		expect(mockTask.say).toHaveBeenCalledWith("user_feedback", "继续等待，并在完成后汇报。", images)
		expect(mockCallbacks.pushToolResult).toHaveBeenCalledWith(
			formatResponse.toolResult("<user_message>\n继续等待，并在完成后汇报。\n</user_message>", images),
		)
	})

	it("renders the reason while the native tool call is streaming", async () => {
		const block = {
			type: "tool_use",
			name: "wait_for_user_confirmation",
			params: { reason: "等待测试完成" },
			partial: true,
			nativeArgs: { reason: "等待测试完成" },
		} as ToolUse<"wait_for_user_confirmation">

		await tool.handlePartial(mockTask, block)

		expect(mockTask.ask).toHaveBeenCalledWith("wait_for_user_confirmation", "等待测试完成", true)
	})
})
