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
		t: (key: string, options?: Record<string, string | number>) => {
			if (key === "chat:externalToolResult.description") {
				return `${options?.name} returned ${options?.byteSize}, over ${options?.threshold}`
			}
			const map: Record<string, string> = {
				"chat:subtasks.wantsToCreate": "Roo wants to create a new subtask",
				"chat:subtasks.resultContent": "Task result",
				"chat:subtasks.goToSubtask": "Go to subtask",
				"chat:externalToolResult.title": "Large external tool result",
				"chat:externalToolResult.preview": "Preview",
				"chat:editMessage.edit": "Edit message",
				"chat:editMessage.delete": "Delete message",
				"chat:editMessage.placeholder": "Edit your message...",
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
let mockRenderContext: "sidebar" | "editor" | "composer" = "sidebar"
let mockUserAvatarUrl: string | undefined

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpServers: [],
		alwaysAllowMcp: false,
		currentCheckpoint: null,
		mode: "code",
		apiConfiguration: {},
		commands: [],
		openedTabs: [],
		filePaths: [],
		gitCommits: [],
		clineMessages: mockClineMessages,
		currentTaskItem: mockCurrentTaskItem,
		renderContext: mockRenderContext,
		agentName: "Zoo Code",
		userAvatarUrl: mockUserAvatarUrl,
	}),
}))

// Mock useSelectedModel hook
vi.mock("@src/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => ({ info: { supportsImages: true } }),
}))

vi.mock("../ChatTextArea", () => ({
	ChatTextArea: ({ placeholderText }: { placeholderText: string }) => <input placeholder={placeholderText} />,
}))

function renderChatRow(
	message: any,
	currentTaskItem?: Partial<HistoryItem>,
	clineMessages?: ClineMessage[],
	renderContext: "sidebar" | "editor" | "composer" = "sidebar",
) {
	mockCurrentTaskItem = currentTaskItem
	mockClineMessages = clineMessages || [message]
	mockRenderContext = renderContext
	mockUserAvatarUrl = undefined

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

describe("ChatRow - conversational editor layout", () => {
	it("renders Agent text as a left-aligned bubble with an avatar", () => {
		const message = {
			ts: Date.now(),
			type: "say" as const,
			say: "text" as const,
			text: "Hello from Zoo Code",
		}
		renderChatRow(message, undefined, [message], "editor")

		const bubble = screen.getByTestId("agent-message")
		expect(bubble).toHaveClass("justify-start")
		expect(bubble).toHaveClass("items-end")
		const messageContent = bubble.children.item(1)
		expect(messageContent).toHaveClass("w-fit")
		expect(messageContent).not.toHaveClass("w-full")
		expect(messageContent).toHaveClass("max-w-[82%]")
		expect(messageContent).toHaveClass("min-[760px]:max-w-[70%]")
		expect(screen.getByTestId("agent-avatar")).toBeInTheDocument()
	})

	it("renders user feedback as a right-aligned bubble with an avatar", () => {
		const message = {
			ts: Date.now(),
			type: "say" as const,
			say: "user_feedback" as const,
			text: "Hello from user",
		}
		renderChatRow(message, undefined, [message], "editor")

		const bubble = screen.getByTestId("user-message")
		expect(bubble).toHaveClass("justify-end")
		expect(bubble).toHaveClass("items-end")
		const messageContent = bubble.firstElementChild
		expect(messageContent).toHaveClass("w-fit")
		expect(messageContent).not.toHaveClass("w-full")
		expect(messageContent).toHaveClass("max-w-[82%]")
		expect(messageContent).toHaveClass("min-[760px]:max-w-[70%]")
		expect(screen.getByTestId("user-avatar")).toBeInTheDocument()
	})

	it("renders the selected local avatar URL for user feedback", () => {
		const message = {
			ts: Date.now(),
			type: "say" as const,
			say: "user_feedback" as const,
			text: "Hello from user",
		}
		mockUserAvatarUrl = "vscode-webview://user-avatar/avatar.png"
		mockCurrentTaskItem = undefined
		mockClineMessages = [message]
		mockRenderContext = "editor"

		render(
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

		expect(screen.getByTestId("user-avatar")).toHaveAttribute("src", "vscode-webview://user-avatar/avatar.png")
	})

	it("lets users delete an editor-layout message", () => {
		const message = {
			ts: 123,
			type: "say" as const,
			say: "user_feedback" as const,
			text: "Hello from user",
		}
		renderChatRow(message, undefined, [message], "editor")

		fireEvent.click(screen.getByRole("button", { name: "Delete message" }))
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "deleteMessage", value: 123 })
	})

	it("lets users edit an editor-layout message", () => {
		const message = {
			ts: 123,
			type: "say" as const,
			say: "user_feedback" as const,
			text: "Hello from user",
		}
		renderChatRow(message, undefined, [message], "editor")

		fireEvent.click(screen.getByRole("button", { name: "Edit message" }))
		expect(screen.getByPlaceholderText("Edit your message...")).toBeInTheDocument()
	})

	it("keeps follow-up options outside the editor question bubble", () => {
		const message = {
			ts: Date.now(),
			type: "ask" as const,
			ask: "followup" as const,
			text: JSON.stringify({
				question: "Which approach should I use?",
				suggest: [{ answer: "Use the existing sidebar behavior" }],
			}),
		}
		const { getByTestId, getByText } = renderChatRow(message, undefined, [message], "editor")

		const question = getByTestId("agent-question")
		const questionContent = question.children.item(1)!
		const bubble = questionContent.children.item(0)!
		const suggestions = questionContent.children.item(1)!

		expect(questionContent).toHaveClass("w-full")
		expect(questionContent).not.toHaveClass("w-fit")
		expect(bubble).toContainElement(getByText("Which approach should I use?"))
		expect(bubble).not.toContainElement(getByText("Use the existing sidebar behavior"))
		expect(suggestions).toHaveClass("mt-2")
		expect(suggestions).toContainElement(getByText("Use the existing sidebar behavior"))
	})

	it("keeps API request status outside the editor chat bubble layout", () => {
		const message = {
			ts: Date.now(),
			type: "say" as const,
			say: "api_req_started" as const,
			text: JSON.stringify({ request: "test" }),
		}
		renderChatRow(message, undefined, [message], "editor")

		expect(screen.queryByTestId("agent-message")).not.toBeInTheDocument()
		expect(screen.queryByTestId("user-message")).not.toBeInTheDocument()
		expect(screen.queryByTestId("agent-avatar")).not.toBeInTheDocument()
	})
})

describe("ChatRow - subtask links", () => {
	it("renders metadata and a bounded preview for an oversized external result approval", () => {
		const message = {
			ts: Date.now(),
			type: "ask" as const,
			ask: "external_tool_result" as const,
			text: JSON.stringify({
				source: "mcp_tool",
				name: "playwright/browser_snapshot",
				byteSize: 20 * 1024,
				thresholdBytes: 16 * 1024,
				preview: "Page heading",
				imageCount: 0,
			}),
		}

		renderChatRow(message)

		expect(screen.getByText("Large external tool result")).toBeInTheDocument()
		expect(screen.getByText("playwright/browser_snapshot returned 20.0 KiB, over 16.0 KiB")).toBeInTheDocument()
		expect(screen.getByText("Page heading")).toBeInTheDocument()
	})

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
