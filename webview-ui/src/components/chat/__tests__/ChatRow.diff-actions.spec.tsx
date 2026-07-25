import React from "react"
import { fireEvent, render, screen } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ClineMessage } from "@roo-code/types"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { ChatRowContent } from "../ChatRow"

const mockPostMessage = vi.fn()

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: (...args: unknown[]) => mockPostMessage(...args),
	},
}))

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const map: Record<string, string> = {
				"chat:fileOperations.wantsToEdit": "Roo wants to edit this file",
				"chat:fileOperations.wantsToEditProtected": "Roo wants to edit a protected file",
				"chat:fileOperations.wantsToEditOutsideWorkspace": "Roo wants to edit outside workspace",
				"chat:fileOperations.wantsToApplyBatchChanges": "Roo wants to apply batch changes",
			}
			return map[key] || key
		},
	}),
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

// Mock CodeBlock (avoid ESM/highlighter costs)
vi.mock("@src/components/common/CodeBlock", () => ({
	default: () => null,
}))

const queryClient = new QueryClient()

function createToolAskMessage(toolPayload: Record<string, unknown>): ClineMessage {
	return {
		type: "ask",
		ask: "tool",
		ts: Date.now(),
		partial: false,
		text: JSON.stringify(toolPayload),
	}
}

function renderChatRow(message: ClineMessage, isExpanded = false) {
	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatRowContent
					message={message}
					isExpanded={isExpanded}
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

describe("ChatRow - inline diff stats and actions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockPostMessage.mockClear()
	})

	it("uses appliedDiff edit treatment (header/icon/diff stats)", () => {
		const diff = "@@ -1,1 +1,1 @@\n-old\n+new\n"
		const message = createToolAskMessage({
			tool: "appliedDiff",
			path: "src/file.ts",
			diff,
			diffStats: { added: 1, removed: 1 },
		})

		const { container } = renderChatRow(message, false)

		expect(screen.getByText("Roo wants to edit this file")).toBeInTheDocument()
		expect(container.querySelector(".codicon-diff")).toBeInTheDocument()
		expect(screen.getByTestId("path-prefix")).toHaveTextContent("src")
		expect(screen.getByTestId("path-suffix")).toHaveTextContent("/file.ts")
		expect(screen.getByText("+1")).toBeInTheDocument()
		expect(screen.getByText("-1")).toBeInTheDocument()
	})

	it("uses same edit treatment for editedExistingFile", () => {
		const diff = "@@ -1,1 +1,1 @@\n-old\n+new\n"
		const message = createToolAskMessage({
			tool: "editedExistingFile",
			path: "src/file.ts",
			diff,
			diffStats: { added: 1, removed: 1 },
		})

		const { container } = renderChatRow(message)

		expect(screen.getByText("Roo wants to edit this file")).toBeInTheDocument()
		expect(container.querySelector(".codicon-diff")).toBeInTheDocument()
		expect(screen.getByText("+1")).toBeInTheDocument()
		expect(screen.getByText("-1")).toBeInTheDocument()
	})

	it("uses same edit treatment for searchAndReplace", () => {
		const diff = "-a\n-b\n+c\n"
		const message = createToolAskMessage({
			tool: "searchAndReplace",
			path: "src/file.ts",
			diff,
			diffStats: { added: 1, removed: 2 },
		})

		const { container } = renderChatRow(message)

		expect(screen.getByText("Roo wants to edit this file")).toBeInTheDocument()
		expect(container.querySelector(".codicon-diff")).toBeInTheDocument()
		expect(screen.getByText("+1")).toBeInTheDocument()
		expect(screen.getByText("-2")).toBeInTheDocument()
	})

	it("uses same edit treatment for newFileCreated", () => {
		const content = "a\nb\nc"
		const message = createToolAskMessage({
			tool: "newFileCreated",
			path: "src/new-file.ts",
			content,
			diffStats: { added: 3, removed: 0 },
		})

		const { container } = renderChatRow(message)

		expect(screen.getByText("Roo wants to edit this file")).toBeInTheDocument()
		expect(container.querySelector(".codicon-diff")).toBeInTheDocument()
		expect(screen.getByText("+3")).toBeInTheDocument()
		expect(screen.getByText("-0")).toBeInTheDocument()
	})

	it("preserves jump-to-file affordance for newFileCreated", () => {
		const message = createToolAskMessage({
			tool: "newFileCreated",
			path: "src/new-file.ts",
			content: "+new file",
			diffStats: { added: 1, removed: 0 },
		})

		const { container } = renderChatRow(message)
		const openFileIcon = container.querySelector(".codicon-link-external") as HTMLElement | null

		expect(openFileIcon).toBeInTheDocument()
		if (!openFileIcon) {
			throw new Error("Expected external link icon for newFileCreated")
		}

		fireEvent.click(openFileIcon)

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "openFile",
			text: "./src/new-file.ts",
		})
	})

	it("preserves protected and outside-workspace messaging in unified branch", () => {
		const outsideWorkspaceMessage = createToolAskMessage({
			tool: "searchAndReplace",
			path: "../outside/file.ts",
			diff: "-a\n+b\n",
			isOutsideWorkspace: true,
			diffStats: { added: 1, removed: 1 },
		})
		renderChatRow(outsideWorkspaceMessage)
		expect(screen.getByText("Roo wants to edit outside workspace")).toBeInTheDocument()

		const protectedMessage = createToolAskMessage({
			tool: "appliedDiff",
			path: "src/protected.ts",
			diff: "-a\n+b\n",
			isProtected: true,
			diffStats: { added: 1, removed: 1 },
		})
		const { container } = renderChatRow(protectedMessage)
		expect(screen.getByText("Roo wants to edit a protected file")).toBeInTheDocument()
		expect(container.querySelector(".codicon-lock")).toBeInTheDocument()
	})

	it("keeps batch diff handling for unified edit tools and opens each file", () => {
		const message = createToolAskMessage({
			tool: "searchAndReplace",
			batchDiffs: [
				{
					path: "src/a.ts",
					changeCount: 1,
					key: "a",
					content: "@@ -1,1 +1,1 @@\n-a\n+b\n",
					diffStats: { added: 1, removed: 1 },
				},
				{
					path: "src/b.ts",
					changeCount: 1,
					key: "b",
					content: "@@ -2,1 +2,1 @@\n-c\n+d\n",
					diffStats: { added: 1, removed: 1 },
				},
			],
		})

		const { container } = renderChatRow(message)

		expect(screen.getByText("Roo wants to apply batch changes")).toBeInTheDocument()
		const prefixes = screen.getAllByTestId("path-prefix")
		const suffixes = screen.getAllByTestId("path-suffix")
		expect(prefixes[0]).toHaveTextContent("src")
		expect(suffixes[0]).toHaveTextContent("/a.ts")
		expect(prefixes[1]).toHaveTextContent("src")
		expect(suffixes[1]).toHaveTextContent("/b.ts")

		const openFileIcons = container.querySelectorAll(".codicon-link-external")
		expect(openFileIcons).toHaveLength(2)

		fireEvent.click(openFileIcons[1])

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "openFile",
			text: "./src/b.ts",
		})
	})

	it("keeps regex file patterns out of middle path truncation", () => {
		const message = createToolAskMessage({
			tool: "searchFiles",
			path: "src",
			filePattern: "*.tsx",
			regex: "Button",
			content: "",
		})

		renderChatRow(message)

		expect(screen.getByText("src/(*.tsx)")).toBeInTheDocument()
		expect(screen.queryByTestId("path-prefix")).not.toBeInTheDocument()
	})
})
