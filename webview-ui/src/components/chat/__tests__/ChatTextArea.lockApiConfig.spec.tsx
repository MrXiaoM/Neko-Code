import { defaultModeSlug } from "@roo/modes"

import { act, render, fireEvent, screen } from "@src/utils/test-utils"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

import { ChatTextArea } from "../ChatTextArea"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@src/components/common/CodeBlock")
vi.mock("@src/components/common/MarkdownBlock")
vi.mock("@src/utils/path-mentions", () => ({
	convertToMentionPath: vi.fn((path: string) => path),
}))

// Mock ExtensionStateContext
vi.mock("@src/context/ExtensionStateContext")

vi.mock("../ReasoningEffortSlider", () => ({
	ReasoningEffortSlider: ({ onCommit }: any) => (
		<>
			<button
				data-testid="commit-reasoning-effort"
				onClick={() => onCommit({ enableReasoningEffort: true, reasoningEffort: undefined })}
			/>
			<button
				data-testid="commit-high-reasoning-effort"
				onClick={() => onCommit({ enableReasoningEffort: true, reasoningEffort: "high" })}
			/>
		</>
	),
}))

const mockPostMessage = vscode.postMessage as ReturnType<typeof vi.fn>

describe("ChatTextArea - lockApiConfigAcrossModes toggle", () => {
	const defaultProps = {
		inputValue: "",
		setInputValue: vi.fn(),
		onSend: vi.fn(),
		sendingDisabled: false,
		selectApiConfigDisabled: false,
		onSelectImages: vi.fn(),
		shouldDisableImages: false,
		placeholderText: "Type a message...",
		selectedImages: [] as string[],
		setSelectedImages: vi.fn(),
		onHeightChange: vi.fn(),
		mode: defaultModeSlug,
		setMode: vi.fn(),
		modeShortcutText: "(⌘. for next mode)",
	}

	const defaultState = {
		filePaths: [],
		openedTabs: [],
		apiConfiguration: { apiProvider: "anthropic" },
		taskHistory: [],
		cwd: "/test/workspace",
		listApiConfigMeta: [{ id: "default", name: "Default", modelId: "claude-3" }],
		currentApiConfigName: "Default",
		pinnedApiConfigs: {},
		togglePinnedApiConfig: vi.fn(),
		setApiConfiguration: vi.fn(),
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	/**
	 * Helper: Opens the ApiConfigSelector popover by clicking the trigger,
	 * then returns the lock toggle button by its aria-label.
	 */
	const openPopoverAndGetLockToggle = (ariaLabel: string) => {
		const trigger = screen.getByTestId("dropdown-trigger")
		fireEvent.click(trigger)
		return screen.getByRole("button", { name: ariaLabel })
	}

	describe("rendering", () => {
		it("renders with muted opacity when lockApiConfigAcrossModes is false", () => {
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				...defaultState,
				lockApiConfigAcrossModes: false,
			})

			render(<ChatTextArea {...defaultProps} />)

			const button = openPopoverAndGetLockToggle("chat:lockApiConfigAcrossModes")
			expect(button).toBeInTheDocument()
			// Unlocked state has muted opacity
			expect(button.className).toContain("opacity-60")
			expect(button.className).not.toContain("text-vscode-focusBorder")
		})

		it("renders with highlight color when lockApiConfigAcrossModes is true", () => {
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				...defaultState,
				lockApiConfigAcrossModes: true,
			})

			render(<ChatTextArea {...defaultProps} />)

			const button = openPopoverAndGetLockToggle("chat:unlockApiConfigAcrossModes")
			expect(button).toBeInTheDocument()
			// Locked state has the focus border highlight color
			expect(button.className).toContain("text-vscode-focusBorder")
			expect(button.className).not.toContain("opacity-60")
		})

		it("renders in unlocked state when lockApiConfigAcrossModes is undefined (default)", () => {
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				...defaultState,
			})

			render(<ChatTextArea {...defaultProps} />)

			const button = openPopoverAndGetLockToggle("chat:lockApiConfigAcrossModes")
			expect(button).toBeInTheDocument()
			// Default (undefined/falsy) renders in unlocked style
			expect(button.className).toContain("opacity-60")
		})
	})

	describe("interaction", () => {
		it("posts lockApiConfigAcrossModes=true message when locking", () => {
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				...defaultState,
				lockApiConfigAcrossModes: false,
			})

			render(<ChatTextArea {...defaultProps} />)

			// Clear any initialization messages
			mockPostMessage.mockClear()

			const button = openPopoverAndGetLockToggle("chat:lockApiConfigAcrossModes")
			fireEvent.click(button)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "lockApiConfigAcrossModes",
				bool: true,
			})
		})

		it("posts lockApiConfigAcrossModes=false message when unlocking", () => {
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				...defaultState,
				lockApiConfigAcrossModes: true,
			})

			render(<ChatTextArea {...defaultProps} />)

			// Clear any initialization messages
			mockPostMessage.mockClear()

			const button = openPopoverAndGetLockToggle("chat:unlockApiConfigAcrossModes")
			fireEvent.click(button)

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "lockApiConfigAcrossModes",
				bool: false,
			})
		})
	})

	describe("reasoning effort persistence", () => {
		it("updates the active configuration immediately and queues persistence after a committed slider change", () => {
			vi.useFakeTimers()
			const setApiConfiguration = vi.fn()
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				...defaultState,
				apiConfiguration: {
					apiProvider: "anthropic",
					enableReasoningEffort: false,
					reasoningEffort: "disable",
				},
				setApiConfiguration,
			})

			render(<ChatTextArea {...defaultProps} />)
			fireEvent.click(screen.getByTestId("dropdown-trigger"))

			fireEvent.click(screen.getByTestId("commit-reasoning-effort"))

			expect(setApiConfiguration).toHaveBeenCalledWith({
				enableReasoningEffort: true,
				reasoningEffort: undefined,
			})
			expect(mockPostMessage).not.toHaveBeenCalledWith(
				expect.objectContaining({ type: "saveApiConfigurationById" }),
			)

			act(() => vi.advanceTimersByTime(150))

			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "saveApiConfigurationById",
				text: "default",
				apiConfiguration: {
					apiProvider: "anthropic",
					enableReasoningEffort: true,
					reasoningEffort: undefined,
				},
			})
			vi.useRealTimers()
		})

		it("keeps the latest committed effort when saves are queued together", () => {
			vi.useFakeTimers()
			const setApiConfiguration = vi.fn()
			;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
				...defaultState,
				apiConfiguration: {
					apiProvider: "anthropic",
					enableReasoningEffort: false,
					reasoningEffort: "disable",
				},
				setApiConfiguration,
			})

			render(<ChatTextArea {...defaultProps} />)
			fireEvent.click(screen.getByTestId("dropdown-trigger"))
			fireEvent.click(screen.getByTestId("commit-reasoning-effort"))
			fireEvent.click(screen.getByTestId("commit-high-reasoning-effort"))

			expect(setApiConfiguration).toHaveBeenCalledTimes(2)
			expect(mockPostMessage).not.toHaveBeenCalledWith(
				expect.objectContaining({ type: "saveApiConfigurationById" }),
			)

			act(() => vi.advanceTimersByTime(150))

			const saveMessages = mockPostMessage.mock.calls
				.map(([message]) => message)
				.filter((message) => message.type === "saveApiConfigurationById")
			expect(saveMessages).toHaveLength(1)
			expect(saveMessages[0]).toEqual({
				type: "saveApiConfigurationById",
				text: "default",
				apiConfiguration: {
					apiProvider: "anthropic",
					enableReasoningEffort: true,
					reasoningEffort: "high",
				},
			})
			vi.useRealTimers()
		})
	})
})
