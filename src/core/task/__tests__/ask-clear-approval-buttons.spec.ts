import { Task } from "../Task"

// When the backend auto-resolves an interactive ask, isAnswered:true is stamped
// on the ClineMessage before it is added so the webview state snapshot already
// carries the resolved flag. This eliminates the race between showing approval
// buttons and the former separate clearApprovalButtons message.

type ProviderStub = {
	getState: () => Promise<any>
	postMessageToWebview: ReturnType<typeof vi.fn>
}

function buildTask(provider: ProviderStub | undefined) {
	const task = Object.create(Task.prototype) as Task
	;(task as any).abort = false
	;(task as any).clineMessages = []
	;(task as any).askResponse = undefined
	;(task as any).askResponseText = undefined
	;(task as any).askResponseImages = undefined
	;(task as any).lastMessageTs = undefined
	;(task as any).addToClineMessages = vi.fn(async () => {})
	;(task as any).saveClineMessages = vi.fn(async () => {})
	;(task as any).updateClineMessage = vi.fn(async () => {})
	;(task as any).cancelAutoApprovalTimeout = vi.fn(() => {})
	;(task as any).checkpointSave = vi.fn(async () => {})
	;(task as any).emit = vi.fn()
	;(task as any).providerRef = { deref: () => provider }

	return task
}

async function attachQueue(task: Task) {
	const { MessageQueueService } = await import("../../message-queue/MessageQueueService")
	;(task as any).messageQueueService = new MessageQueueService()
}

describe("Task.ask auto-approval stamping", () => {
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
		const addCall = (task as any).addToClineMessages.mock.calls[0][0]
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
		const addCall = (task as any).addToClineMessages.mock.calls[0][0]
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
			const added = (task as any).addToClineMessages.mock.calls[0][0]
			;(task as any).clineMessages = [{ ...added }]
			task.approveAsk()
		}, 0)

		await askPromise

		const addCall = (task as any).addToClineMessages.mock.calls[0][0]
		expect(addCall.isAnswered).toBeFalsy()
		expect(addCall.approvalState).toBeUndefined()
		expect((task as any).clineMessages[0].approvalState).toBe("approved")
		expect((task as any).clineMessages[0].isAnswered).toBe(true)
		expect(postMessageToWebview).not.toHaveBeenCalledWith({ type: "clearApprovalButtons" })
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
			const added = (task as any).addToClineMessages.mock.calls[0][0]
			;(task as any).clineMessages = [added]
			task.handleWebviewAskResponse("messageResponse", "do something else instead")
		}, 0)

		await askPromise

		expect((task as any).clineMessages[0].approvalState).toBe("rejected")
		expect((task as any).clineMessages[0].isAnswered).toBe(true)
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
			const added = (task as any).addToClineMessages.mock.calls[0][0]
			;(task as any).clineMessages = [added]
			task.denyAsk()
		}, 0)

		await askPromise

		expect((task as any).clineMessages[0].approvalState).toBe("rejected")
		expect((task as any).clineMessages[0].isAnswered).toBe(true)
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
		;(task as any).addToClineMessages = vi.fn(async (msg: any) => {
			;(task as any).clineMessages.push(msg)
		})

		const result = await task.ask("command", "echo hi", false)

		expect(result.response).toBe("yesButtonClicked")
		expect((task as any).clineMessages[0].approvalState).toBe("auto_approved")
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
		const addCall = (task as any).addToClineMessages.mock.calls[0][0]
		expect(addCall.approvalState).toBe("auto_approved")
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

		const addCall = (task as any).addToClineMessages.mock.calls[0][0]
		expect(addCall.isAnswered).toBeFalsy()
		expect(postMessageToWebview).not.toHaveBeenCalledWith({ type: "clearApprovalButtons" })
	})
})
