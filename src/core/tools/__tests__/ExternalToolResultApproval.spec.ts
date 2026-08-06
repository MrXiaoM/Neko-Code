import type { Task } from "../../task/Task"

import {
	createExternalToolResultDeniedMessage,
	EXTERNAL_TOOL_RESULT_MAX_BYTES,
	getExternalToolResultByteSize,
	requestExternalToolResultApproval,
} from "../ExternalToolResultApproval"

describe("ExternalToolResultApproval", () => {
	it("does not request approval when a result is exactly 16 KiB", async () => {
		const ask = vi.fn()
		const result = { text: "x".repeat(EXTERNAL_TOOL_RESULT_MAX_BYTES) }

		const approval = await requestExternalToolResultApproval(
			{ ask } as unknown as Task,
			"mcp_tool",
			"server/tool",
			result,
		)

		expect(approval).toEqual({ approved: true, byteSize: EXTERNAL_TOOL_RESULT_MAX_BYTES, result })
		expect(ask).not.toHaveBeenCalled()
	})

	it("uses UTF-8 byte size instead of character count", () => {
		const text = "猫".repeat(6)

		expect(getExternalToolResultByteSize({ text })).toBe(18)
	})

	it("returns the full result after the user approves an oversized result", async () => {
		const ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked" })
		const result = { text: "x".repeat(EXTERNAL_TOOL_RESULT_MAX_BYTES + 1), images: ["image-data"] }

		const approval = await requestExternalToolResultApproval(
			{ ask } as unknown as Task,
			"mcp_resource",
			"resource://page",
			result,
		)

		expect(approval.approved).toBe(true)
		expect(approval.result).toEqual(result)
		expect(ask).toHaveBeenCalledWith("external_tool_result", expect.stringContaining('"source":"mcp_resource"'))
	})

	it("does not return oversized text or images when the user rejects it", async () => {
		const ask = vi.fn().mockResolvedValue({ response: "noButtonClicked" })
		const result = {
			text: "sensitive-result-" + "x".repeat(EXTERNAL_TOOL_RESULT_MAX_BYTES),
			images: ["very-large-image-payload"],
		}

		const approval = await requestExternalToolResultApproval(
			{ ask } as unknown as Task,
			"custom_tool",
			"browser_snapshot",
			result,
		)

		expect(approval.approved).toBe(false)
		expect(approval.result.images).toBeUndefined()
		expect(approval.result.text).toBe(createExternalToolResultDeniedMessage("custom_tool", approval.byteSize))
		expect(approval.result.text).not.toContain("sensitive-result")
	})
})
