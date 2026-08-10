const notifyApprovalIfWindowUnfocused = vi.hoisted(() => vi.fn())

vi.mock("../../../integrations/notifications/approvalNotification", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../integrations/notifications/approvalNotification")>()),
	notifyApprovalIfWindowUnfocused,
}))

import type { ClineMessage, RooCodeSettings } from "@roo-code/types"

import { Task } from "../Task"

// When the backend auto-resolves an interactive ask, isAnswered:true is stamped
// on the ClineMessage before it is added so the webview state snapshot already
// carries the resolved flag. This eliminates the race between showing approval
// buttons and the former separate clearApprovalButtons message.

type ProviderStub = {
	getState: () => Promise<Partial<RooCodeSettings>>
	postMessageToWebview: ReturnType<typeof vi.fn>
	clearSubtaskCallback?: ReturnType<typeof vi.fn>
}

type AddToClineMessagesMock = {
	mock: {
		calls: [ClineMessage][]
	}
}

function setTaskField(task: Task, field: string, value: unknown): void {
	Reflect.set(task, field, value)
}

function getTaskField<T>(task: Task, field: string): T {
	return Reflect.get(task, field) as T
}

function getTaskMessages(task: Task): ClineMessage[] {
	return getTaskField<ClineMessage[]>(task, "clineMessages")
}

function buildTask(provider: ProviderStub | undefined): Task {
	const task = Object.create(Task.prototype) as Task
	const addToClineMessages = vi.fn(async (_message: ClineMessage) => {})

	setTaskField(task, "abort", false)
	setTaskField(task, "clineMessages", [])
	setTaskField(task, "askResponse", undefined)
	setTaskField(task, "askResponseText", undefined)
	setTaskField(task, "askResponseImages", undefined)
	setTaskField(task, "lastMessageTs", undefined)
	setTaskField(task, "addToClineMessages", addToClineMessages)
	setTaskField(
		task,
		"saveClineMessages",
		vi.fn(async () => {}),
	)
	setTaskField(
		task,
		"updateClineMessage",
		vi.fn(async () => {}),
	)
	setTaskField(
		task,
		"cancelAutoApprovalTimeout",
		vi.fn(() => {}),
	)
	setTaskField(
		task,
		"checkpointSave",
		vi.fn(async () => {}),
	)
	setTaskField(task, "emit", vi.fn())
	setTaskField(task, "providerRef", { deref: () => provider })

	return task
}

function getAddedMessage(task: Task): ClineMessage {
	return getTaskField<AddToClineMessagesMock>(task, "addToClineMessages").mock.calls[0][0]
}

function setTaskMessages(task: Task, messages: ClineMessage[]): void {
	setTaskField(task, "clineMessages", messages)
}

async function attachQueue(task: Task) {
	const { MessageQueueService } = await import("../../message-queue/MessageQueueService")
	setTaskField(task, "messageQueueService", new MessageQueueService())
}

describe("Task.ask auto-approval stamping", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})
	it("stamps isAnswered:true and approvalState auto_approved when a command ask is auto-approved", async () => {
		const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const provider: ProviderStub = {
			postMessageToWebview,
			getState: async () => ({
				autoApprovalEnabled: true,
				alwaysAllowExecute: true,
				allowedCommands: ["echo"],
				deniedCommands: [],
			}),
		}

		const task = buildTask(provider)
		await attachQueue(task)

		const result = await task.ask("command", "echo hi", false)

		expect(result.response).toBe("yesButtonClicked")
		// The message must carry isAnswered:true so the webview never shows buttons.
		const addCall = getAddedMessage(task)
		expect(addCall.isAnswered).toBe(true)
		expect(addCall.approvalState).toBe("auto_approved")
		// clearApprovalButtons is no longer sent as a separate message.
		expect(postMessageToWebview).not.toHaveBeenCalledWith({ type: "clearApprovalButtons" })
	})

	it("stamps isAnswered:true and approvalState rejected when a command ask is auto-denied", async () => {
		const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const provider: ProviderStub = {
			postMessageToWebview,
			getState: async () => ({
				autoApprovalEnabled: true,
				alwaysAllowExecute: true,
				allowedCommands: [],
				deniedCommands: ["echo"],
			}),
		}

		const task = buildTask(provider)
		await attachQueue(task)

		const result = await task.ask("command", "echo hi", false)

		expect(result.response).toBe("noButtonClicked")
		const addCall = getAddedMessage(task)
		expect(addCall.isAnswered).toBe(true)
		expect(addCall.approvalState).toBe("rejected")
		expect(postMessageToWebview).not.toHaveBeenCalledWith({ type: "clearApprovalButtons" })
	})

	it("stamps approved on manual Run without overwriting later, and leaves add-time approval empty", async () => {
		const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const provider: ProviderStub = {
			postMessageToWebview,
			getState: async () => ({
				autoApprovalEnabled: false,
				alwaysAllowExecute: false,
				allowedCommands: [],
				deniedCommands: [],
			}),
		}

		const task = buildTask(provider)
		await attachQueue(task)

		const askPromise = task.ask("command", "echo hi", false)

		// Simulate the user clicking Run after the buttons are shown.
		setTimeout(() => {
			// Mirror production: message already lives in clineMessages when the user answers.
			// Clone so later mutation of clineMessages does not rewrite the original add() arg snapshot.
			const added = getAddedMessage(task)
			setTaskMessages(task, [{ ...added }])
			task.approveAsk()
		}, 0)

		await askPromise

		const addCall = getAddedMessage(task)
		expect(addCall.isAnswered).toBeFalsy()
		expect(addCall.approvalState).toBeUndefined()
		expect(getTaskMessages(task)[0].approvalState).toBe("approved")
		expect(getTaskMessages(task)[0].isAnswered).toBe(true)
		expect(postMessageToWebview).not.toHaveBeenCalledWith({ type: "clearApprovalButtons" })
	})

	it("does not approve a historical command when resuming a task", () => {
		const task = buildTask(undefined)
		const historicalCommand: ClineMessage = {
			ts: 1,
			type: "ask",
			ask: "command",
			text: "echo hi",
		}
		const resumeAsk: ClineMessage = {
			ts: 2,
			type: "ask",
			ask: "resume_task",
		}
		setTaskMessages(task, [historicalCommand, resumeAsk])
		setTaskField(task, "lastMessageTs", resumeAsk.ts)

		task.handleWebviewAskResponse("yesButtonClicked")

		expect(historicalCommand.isAnswered).toBeUndefined()
		expect(historicalCommand.approvalState).toBeUndefined()
		expect(resumeAsk.isAnswered).toBeUndefined()
		expect(getTaskField(task, "askResponse")).toBe("yesButtonClicked")
	})

	it("keeps the parent callback when a resumed subtask continues with a new instruction", () => {
		const clearSubtaskCallback = vi.fn()
		const task = buildTask({
			getState: async () => ({}),
			postMessageToWebview: vi.fn(),
			clearSubtaskCallback,
		})
		setTaskField(task, "parentTaskId", "parent-task")

		task.handleWebviewAskResponse("messageResponse", "继续处理剩余工作")

		expect(clearSubtaskCallback).not.toHaveBeenCalled()
	})

	it("stamps rejected when the user sends a message instead of approving a command", async () => {
		const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const provider: ProviderStub = {
			postMessageToWebview,
			getState: async () => ({
				autoApprovalEnabled: false,
				alwaysAllowExecute: false,
				allowedCommands: [],
				deniedCommands: [],
			}),
		}

		const task = buildTask(provider)
		await attachQueue(task)

		const askPromise = task.ask("command", "echo hi", false)

		setTimeout(() => {
			const added = getAddedMessage(task)
			setTaskMessages(task, [added])
			task.handleWebviewAskResponse("messageResponse", "do something else instead")
		}, 0)

		await askPromise

		expect(getTaskMessages(task)[0].approvalState).toBe("rejected")
		expect(getTaskMessages(task)[0].isAnswered).toBe(true)
	})

	it("stamps rejected when the user clicks Deny on a command", async () => {
		const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const provider: ProviderStub = {
			postMessageToWebview,
			getState: async () => ({
				autoApprovalEnabled: false,
				alwaysAllowExecute: false,
				allowedCommands: [],
				deniedCommands: [],
			}),
		}

		const task = buildTask(provider)
		await attachQueue(task)

		const askPromise = task.ask("command", "echo hi", false)

		setTimeout(() => {
			const added = getAddedMessage(task)
			setTaskMessages(task, [added])
			task.denyAsk()
		}, 0)

		await askPromise

		expect(getTaskMessages(task)[0].approvalState).toBe("rejected")
		expect(getTaskMessages(task)[0].isAnswered).toBe(true)
	})

	it("does not overwrite auto_approved when approveAsk is invoked from the auto path", async () => {
		const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const provider: ProviderStub = {
			postMessageToWebview,
			getState: async () => ({
				autoApprovalEnabled: true,
				alwaysAllowExecute: true,
				allowedCommands: ["echo"],
				deniedCommands: [],
			}),
		}

		const task = buildTask(provider)
		await attachQueue(task)

		// Capture the stamped message into clineMessages so handleWebviewAskResponse can see it.
		setTaskField(
			task,
			"addToClineMessages",
			vi.fn(async (message: ClineMessage) => {
				getTaskMessages(task).push(message)
			}),
		)

		const result = await task.ask("command", "echo hi", false)

		expect(result.response).toBe("yesButtonClicked")
		expect(getTaskMessages(task)[0].approvalState).toBe("auto_approved")
	})

	it("auto-approves JSON command approval payloads using the embedded command", async () => {
		const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const provider: ProviderStub = {
			postMessageToWebview,
			getState: async () => ({
				autoApprovalEnabled: true,
				alwaysAllowExecute: true,
				allowedCommands: ["echo"],
				deniedCommands: [],
			}),
		}

		const task = buildTask(provider)
		await attachQueue(task)

		const payload = JSON.stringify({
			command: "echo hi",
			terminalInfo: { provider: "vscode", willReuseTerminal: false, cwd: "/tmp" },
		})
		const result = await task.ask("command", payload, false)

		expect(result.response).toBe("yesButtonClicked")
		const addCall = getAddedMessage(task)
		expect(addCall.approvalState).toBe("auto_approved")
	})

	it("does not send a system notification for manual approval when disabled", async () => {
		vi.useFakeTimers()
		const provider: ProviderStub = {
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
			getState: async () => ({
				autoApprovalEnabled: false,
				alwaysAllowExecute: false,
				systemNotificationOnApproval: false,
			}),
		}
		const task = buildTask(provider)
		await attachQueue(task)

		const askPromise = task.ask("command", "echo hi", false)
		setTimeout(() => {
			setTaskMessages(task, [getAddedMessage(task)])
			task.approveAsk()
		}, 301)
		await vi.runAllTimersAsync()
		await askPromise

		expect(notifyApprovalIfWindowUnfocused).not.toHaveBeenCalled()
		vi.useRealTimers()
	})

	it("does not send a system notification for task completion when disabled", async () => {
		vi.useFakeTimers()
		const provider: ProviderStub = {
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
			getState: async () => ({ systemNotificationOnOther: false }),
		}
		const task = buildTask(provider)
		await attachQueue(task)

		const askPromise = task.ask("completion_result", "Task complete", false)
		setTimeout(() => {
			setTaskMessages(task, [getAddedMessage(task)])
			task.approveAsk()
		}, 301)
		await vi.runAllTimersAsync()
		await askPromise

		expect(notifyApprovalIfWindowUnfocused).not.toHaveBeenCalled()
		vi.useRealTimers()
	})

	it("does not stamp isAnswered for the followup timeout branch", async () => {
		const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const provider: ProviderStub = {
			postMessageToWebview,
			getState: async () => ({
				autoApprovalEnabled: true,
				alwaysAllowFollowupQuestions: true,
				followupAutoApproveTimeoutMs: 60_000,
			}),
		}

		const task = buildTask(provider)
		await attachQueue(task)

		const suggestions = JSON.stringify({ suggest: [{ answer: "yes" }] })
		const askPromise = task.ask("followup", suggestions, false)

		// Resolve the ask before the long timeout fires so the test completes.
		setTimeout(() => {
			task.approveAsk()
		}, 0)

		await askPromise

		const addCall = getAddedMessage(task)
		expect(addCall.isAnswered).toBeFalsy()
		expect(postMessageToWebview).not.toHaveBeenCalledWith({ type: "clearApprovalButtons" })
	})
})
