import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"
import { ChatRowContent } from "../ChatRow"
import type { HistoryItem, ClineMessage } from "@roo-code/types"

// Mock vscode API
const mockPostMessage = vi.fn()
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: (msg: unknown) => mockPostMessage(msg),
	},
}))

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const map: Record<string, string> = {
				"chat:subtasks.wantsToCreate": "Roo wants to create a new subtask",
				"chat:subtasks.resultContent": "Task result",
				"chat:subtasks.goToSubtask": "Go to subtask",
			}
			return map[key] ?? key
		},
		i18n: { exists: () => true },
	}),
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

// Mock extension state context
let mockCurrentTaskItem: Partial<HistoryItem> | undefined = undefined
let mockClineMessages: ClineMessage[] = []

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpServers: [],
		alwaysAllowMcp: false,
		currentCheckpoint: null,
		mode: "code",
		apiConfiguration: {},
		clineMessages: mockClineMessages,
		currentTaskItem: mockCurrentTaskItem,
	}),
}))

// Mock useSelectedModel hook
vi.mock("@src/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => ({ info: { supportsImages: true } }),
}))

function renderChatRow(message: any, currentTaskItem?: Partial<HistoryItem>, clineMessages?: ClineMessage[]) {
	mockCurrentTaskItem = currentTaskItem
	mockClineMessages = clineMessages || [message]

	return render(
		<ChatRowContent
			message={message}
			isExpanded={false}
			isLast={false}
			isStreaming={false}
			onToggleExpand={() => {}}
			onSuggestionClick={() => {}}
			onBatchFileResponse={() => {}}
			onFollowUpUnmount={() => {}}
			isFollowUpAnswered={false}
		/>,
	)
}

describe("ChatRow - subtask links", () => {
	beforeEach(() => {
		mockPostMessage.mockClear()
	})

	describe("newTask tool", () => {
		it("should display 'Go to subtask' link from the message subtaskId", () => {
			const message = {
				ts: Date.now(),
				type: "ask" as const,
				ask: "tool" as const,
				subtaskId: "child-task-123",
				text: JSON.stringify({
					tool: "newTask",
					mode: "code",
					content: "Implement feature X",
				}),
			}

			renderChatRow(message)

			const goToSubtaskButton = screen.getByText("Go to subtask")
			expect(goToSubtaskButton).toBeInTheDocument()

			fireEvent.click(goToSubtaskButton)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "child-task-123",
			})
		})

		it("does not infer a link from legacy childIds", () => {
			const message = {
				ts: Date.now(),
				type: "ask" as const,
				ask: "tool" as const,
				text: JSON.stringify({
					tool: "newTask",
					mode: "architect",
					content: "Design system architecture",
				}),
			}

			renderChatRow(message, { childIds: ["first-child", "second-child"] })

			expect(screen.queryByText("Go to subtask")).toBeNull()
		})

		it("should not display 'Go to subtask' link when no child task exists", () => {
			const message = {
				ts: Date.now(),
				type: "ask" as const,
				ask: "tool" as const,
				text: JSON.stringify({
					tool: "newTask",
					mode: "code",
					content: "Implement feature X",
				}),
			}

			renderChatRow(message, undefined)

			const goToSubtaskButton = screen.queryByText("Go to subtask")
			expect(goToSubtaskButton).toBeNull()
		})

		it("should not display 'Go to subtask' link when directly followed by subtask_result", () => {
			const newTaskMessage = {
				ts: 1000,
				type: "ask" as const,
				ask: "tool" as const,
				text: JSON.stringify({
					tool: "newTask",
					mode: "code",
					content: "Implement feature X",
				}),
			}

			const subtaskResultMessage = {
				ts: 1001,
				type: "say" as const,
				say: "subtask_result" as const,
				text: "The subtask has been completed successfully.",
			}

			// Pass both messages in the clineMessages array
			renderChatRow(newTaskMessage, { delegatedToId: "child-task-123" }, [
				newTaskMessage,
				subtaskResultMessage,
			] as ClineMessage[])

			// Button should be hidden because next message is subtask_result
			const goToSubtaskButton = screen.queryByText("Go to subtask")
			expect(goToSubtaskButton).toBeNull()
		})
		it("renders a thick amber left border for subtask creation content", () => {
			const message = {
				ts: Date.now(),
				type: "ask" as const,
				ask: "tool" as const,
				text: JSON.stringify({
					tool: "newTask",
					mode: "code",
					content: "Implement feature X",
				}),
			}

			const { container } = renderChatRow(message)

			expect(
				container.querySelector('[class~="border-l-2"][class~="border-vscode-editorWarning-foreground/50"]'),
			).toBeInTheDocument()
		})
	})

	describe("subtask_result say message", () => {
		it("should display 'Go to subtask' link when currentTaskItem has completedByChildId", () => {
			const message = {
				ts: Date.now(),
				type: "say" as const,
				say: "subtask_result" as const,
				text: "The subtask has been completed successfully.",
			}

			renderChatRow(message, {
				completedByChildId: "completed-child-456",
			})

			const goToSubtaskButton = screen.getByText("Go to subtask")
			expect(goToSubtaskButton).toBeInTheDocument()

			fireEvent.click(goToSubtaskButton)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "showTaskWithId",
				text: "completed-child-456",
			})
		})

		it("should not display 'Go to subtask' link when no completedByChildId exists", () => {
			const message = {
				ts: Date.now(),
				type: "say" as const,
				say: "subtask_result" as const,
				text: "The subtask has been completed successfully.",
			}

			renderChatRow(message, undefined)

			const goToSubtaskButton = screen.queryByText("Go to subtask")
			expect(goToSubtaskButton).toBeNull()
		})

		it("renders a thick blue left border for subtask result content", () => {
			const message = {
				ts: Date.now(),
				type: "say" as const,
				say: "subtask_result" as const,
				text: "The subtask has been completed successfully.",
			}

			const { container } = renderChatRow(message)

			expect(
				container.querySelector('[class~="border-l-2"][class~="border-vscode-textLink-foreground/50"]'),
			).toBeInTheDocument()
		})
	})
})
