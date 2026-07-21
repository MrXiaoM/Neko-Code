import { Task } from "../Task"

// Keep this test focused: queued messages should only auto-fulfill conversational
// asks. Command/tool/mcp approval asks must never be implicitly approved from the queue.

async function buildTask() {
	const task = Object.create(Task.prototype) as Task
	;(task as any).abort = false
	;(task as any).clineMessages = []
	;(task as any).askResponse = undefined
	;(task as any).askResponseText = undefined
	;(task as any).askResponseImages = undefined
	;(task as any).lastMessageTs = undefined

	const { MessageQueueService } = await import("../../message-queue/MessageQueueService")
	;(task as any).messageQueueService = new MessageQueueService()

	// Minimal stubs used by ask()
	;(task as any).addToClineMessages = vi.fn(async () => {})
	;(task as any).saveClineMessages = vi.fn(async () => {})
	;(task as any).updateClineMessage = vi.fn(async () => {})
	;(task as any).cancelAutoApprovalTimeout = vi.fn(() => {})
	;(task as any).checkpointSave = vi.fn(async () => {})
	;(task as any).emit = vi.fn()
	;(task as any).providerRef = { deref: () => undefined }

	return task
}

describe("Task.ask queued message drain", () => {
	it("consumes queued message while blocked on followup ask", async () => {
		const task = await buildTask()

		const askPromise = task.ask("followup", "Q?", false)

		// Simulate webview queuing the user's selection text while the ask is pending.
		;(task as any).messageQueueService.addMessage("picked answer")

		const result = await askPromise
		expect(result.response).toBe("messageResponse")
		expect(result.text).toBe("picked answer")
		expect((task as any).messageQueueService.isEmpty()).toBe(true)
	})

	it("does not consume queued messages for command_output asks", async () => {
		const task = await buildTask()

		const askPromise = task.ask("command_output", "command is still running...", false)
		;(task as any).messageQueueService.addMessage("1+1=?")

		setTimeout(() => {
			task.approveAsk()
		}, 0)

		const result = await askPromise

		expect(result.response).toBe("yesButtonClicked")
		expect(result.text).toBeUndefined()
		expect((task as any).messageQueueService.isEmpty()).toBe(false)
		expect((task as any).messageQueueService.messages[0]?.text).toBe("1+1=?")
	})

	it("does not auto-approve command asks from queued messages", async () => {
		const task = await buildTask()

		const askPromise = task.ask("command", "echo hi", false)
		;(task as any).messageQueueService.addMessage("please also fix the tests")

		// Queued text must not resolve the approval. Explicit user approval is required.
		setTimeout(() => {
			task.approveAsk()
		}, 50)

		const result = await askPromise

		expect(result.response).toBe("yesButtonClicked")
		expect(result.text).toBeUndefined()
		expect((task as any).messageQueueService.isEmpty()).toBe(false)
		expect((task as any).messageQueueService.messages[0]?.text).toBe("please also fix the tests")
	})

	it("does not auto-approve tool asks from queued messages", async () => {
		const task = await buildTask()

		const askPromise = task.ask("tool", JSON.stringify({ tool: "appliedDiff", path: "a.ts" }), false)
		;(task as any).messageQueueService.addMessage("queued while editing files")

		setTimeout(() => {
			task.approveAsk()
		}, 50)

		const result = await askPromise

		expect(result.response).toBe("yesButtonClicked")
		expect(result.text).toBeUndefined()
		expect((task as any).messageQueueService.isEmpty()).toBe(false)
		expect((task as any).messageQueueService.messages[0]?.text).toBe("queued while editing files")
	})

	it("does not auto-approve use_mcp_server asks from queued messages", async () => {
		const task = await buildTask()

		const askPromise = task.ask(
			"use_mcp_server",
			JSON.stringify({ serverName: "demo", type: "use_mcp_tool" }),
			false,
		)
		;(task as any).messageQueueService.addMessage("queued during mcp approval")

		setTimeout(() => {
			task.denyAsk()
		}, 50)

		const result = await askPromise

		expect(result.response).toBe("noButtonClicked")
		expect((task as any).messageQueueService.isEmpty()).toBe(false)
		expect((task as any).messageQueueService.messages[0]?.text).toBe("queued during mcp approval")
	})
})
