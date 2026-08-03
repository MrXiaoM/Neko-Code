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
	Object.defineProperty(task, "backgroundSystemEvents", { value: [], writable: true })
	Object.defineProperty(task, "taskLoopActive", { value: false, writable: true })
	Object.defineProperty(task, "backgroundEventContinuation", { value: undefined, writable: true })
	Object.defineProperty(task, "abandoned", { value: false, writable: true })

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

describe("Task 后台命令完成事件", () => {
	it("任务空闲时只启动一个包含最终命令结果的续跑回合", async () => {
		const task = await buildTask()
		const initiateTaskLoop = vi.fn(async () => {})
		Object.defineProperty(task, "initiateTaskLoop", { value: initiateTaskLoop, writable: true })
		Object.defineProperty(task, "taskId", { value: "task-id", writable: true })
		Object.defineProperty(task, "instanceId", { value: "instance-id", writable: true })

		task.enqueueBackgroundCommandCompletion("退出码：0\n输出：BUILD SUCCESSFUL")
		task.enqueueBackgroundCommandCompletion("退出码：1\n输出：second command")

		await vi.waitFor(() => expect(initiateTaskLoop).toHaveBeenCalledTimes(1))
		expect(initiateTaskLoop).toHaveBeenCalledWith([
			{
				type: "text",
				text: "<background_command_completion>\n退出码：0\n输出：BUILD SUCCESSFUL\n</background_command_completion>",
			},
			{
				type: "text",
				text: "<background_command_completion>\n退出码：1\n输出：second command\n</background_command_completion>",
			},
		])
	})

	it("任务活跃时在安全边界消费事件而不并发启动回合", async () => {
		const task = await buildTask()
		Object.defineProperty(task, "taskLoopActive", { value: true, writable: true })
		Object.defineProperty(task, "backgroundSystemEvents", { value: [], writable: true })
		Object.defineProperty(task, "userMessageContent", { value: [], writable: true })
		const initiateTaskLoop = vi.fn(async () => {})
		Object.defineProperty(task, "initiateTaskLoop", { value: initiateTaskLoop, writable: true })

		task.enqueueBackgroundCommandCompletion("退出码：0\n输出：active command")
		Reflect.apply(Object.getOwnPropertyDescriptor(Task.prototype, "consumeBackgroundSystemEvents")!.value, task, [])

		expect(initiateTaskLoop).not.toHaveBeenCalled()
		expect(Object.getOwnPropertyDescriptor(task, "userMessageContent")!.value).toEqual([
			{
				type: "text",
				text: "<background_command_completion>\n退出码：0\n输出：active command\n</background_command_completion>",
			},
		])
	})
})
