import React from "react"
import { fireEvent, render, screen } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ClineMessage } from "@roo-code/types"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"

import { ChatRowContent } from "../ChatRow"
import { TodoChangeDisplay } from "../TodoChangeDisplay"
import { TodoListDisplay } from "../TodoListDisplay"

const mockPostMessage = vi.fn()

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: (...args: unknown[]) => mockPostMessage(...args),
	},
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const map: Record<string, string> = {
				"chat:modes.reasonLabel": "Reason",
				"chat:modes.wantsToSwitch": "Zoo wants to switch mode",
				"chat:modes.didSwitch": "Zoo switched mode",
				"chat:todo.updated": "Todo List Updated",
				"chat:todo.partial": "{{completed}}/{{total}} complete",
				"chat:todo.complete": "All {{total}} complete",
			}
			return map[key] || key
		},
	}),
	Trans: ({ i18nKey, components }: { i18nKey: string; components?: Record<string, React.ReactElement> }) => (
		<>
			{i18nKey}
			{components?.code}
		</>
	),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("@src/components/common/CodeBlock", () => ({
	default: () => null,
}))

vi.mock("@src/components/common/MermaidBlock", () => ({
	default: () => null,
}))

const createQueryClient = () => new QueryClient()

function createToolAskMessage(toolPayload: Record<string, unknown>): ClineMessage {
	return {
		type: "ask",
		ask: "tool",
		ts: Date.now(),
		partial: false,
		text: JSON.stringify(toolPayload),
	}
}

function renderChatRow(message: ClineMessage) {
	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={createQueryClient()}>
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
				/>
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

describe("Chat markdown rendering for compact tool UI", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockPostMessage.mockClear()
	})

	it("renders markdown links in todo change entries", () => {
		render(
			<TodoChangeDisplay
				previousTodos={[]}
				newTodos={[
					{
						id: "todo-1",
						content: "Review [`ChatRow.tsx`](webview-ui/src/components/chat/ChatRow.tsx:888)",
						status: "in_progress",
					},
				]}
			/>,
		)

		const link = screen.getByRole("link", { name: "ChatRow.tsx" })
		expect(link).toHaveAttribute("href", "webview-ui/src/components/chat/ChatRow.tsx:888")
	})

	it("renders markdown links in expanded todo list entries while keeping collapsed text plain", () => {
		render(
			<TodoListDisplay
				todos={[
					{
						id: "todo-1",
						content: "Review [`ChatRow.tsx`](webview-ui/src/components/chat/ChatRow.tsx:888)",
						status: "in_progress",
					},
				]}
			/>,
		)

		expect(screen.queryByRole("link", { name: "ChatRow.tsx" })).not.toBeInTheDocument()

		fireEvent.click(screen.getByText(/Review/))

		const link = screen.getByRole("link", { name: "ChatRow.tsx" })
		expect(link).toHaveAttribute("href", "webview-ui/src/components/chat/ChatRow.tsx:888")
	})

	it("renders markdown links in switch mode reason and keeps them clickable", () => {
		const message = createToolAskMessage({
			tool: "switchMode",
			mode: "code",
			reason: "Need [`ChatRow.tsx`](webview-ui/src/components/chat/ChatRow.tsx:888)",
		})

		renderChatRow(message)

		const link = screen.getByRole("link", { name: "ChatRow.tsx" })
		expect(link).toHaveAttribute("href", "webview-ui/src/components/chat/ChatRow.tsx:888")

		fireEvent.click(link)

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "openFile",
			text: "./webview-ui/src/components/chat/ChatRow.tsx",
			values: { line: 888 },
		})
	})
})
