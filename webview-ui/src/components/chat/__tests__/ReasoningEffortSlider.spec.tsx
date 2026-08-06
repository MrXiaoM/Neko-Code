import type { ModelInfo, ProviderSettings } from "@roo-code/types"

import { createEvent, fireEvent, render, screen } from "@/utils/test-utils"

import { ReasoningEffortSlider } from "../ReasoningEffortSlider"

const { translate } = vi.hoisted(() => ({
	translate: vi.fn((key: string) => key),
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: translate }),
}))

const defaultProps = {
	apiConfiguration: {
		apiProvider: "openai-native",
		reasoningEffort: "low",
		enableReasoningEffort: true,
	} satisfies ProviderSettings,
	configName: "My OpenAI profile",
	modelId: "gpt-5.2",
	modelInfo: {
		contextWindow: 128_000,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "high"],
	} satisfies ModelInfo,
	onCommit: vi.fn(),
}

const setRailDimensions = (rail: HTMLElement) => {
	vi.spyOn(rail, "getBoundingClientRect").mockReturnValue({
		bottom: 28,
		height: 28,
		left: 0,
		right: 220,
		top: 0,
		width: 220,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	})
}

const firePointerEvent = (element: HTMLElement, type: "pointerDown" | "pointerUp", clientX: number) => {
	const event = createEvent[type](element, { pointerId: 1 })
	Object.defineProperty(event, "clientX", { value: clientX })
	fireEvent(element, event)
}

describe("ReasoningEffortSlider", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		delete document.body.dataset.vscodeThemeKind
		document.body.className = ""
		translate.mockImplementation((key: string) => key)
	})

	it("stacks the configuration name above the model and aligns all visual markers on one rail", () => {
		render(<ReasoningEffortSlider {...defaultProps} />)

		const configName = screen.getByText("My OpenAI profile")
		const modelName = screen.getByText("gpt-5.2")
		const thumb = screen.getByTestId("reasoning-effort-thumb")
		const activeTick = screen.getByTestId("reasoning-effort-tick-1")
		expect(configName.parentElement).toContainElement(modelName)
		expect(screen.queryByText("openai-native")).not.toBeInTheDocument()
		expect(screen.getAllByTestId(/^reasoning-effort-tick-/)).toHaveLength(3)
		expect(screen.getByTestId("reasoning-effort-value").className).toContain("mt-1.5")
		expect(screen.getByTestId("reasoning-effort-progress")).toHaveStyle({ width: "calc(50% + 18px)" })
		expect(screen.getByTestId("reasoning-effort-progress")).toHaveStyle({
			backgroundImage:
				"linear-gradient(90deg, color-mix(in srgb, var(--vscode-button-background) 78%, black), var(--vscode-button-background))",
		})
		expect(screen.getByTestId("reasoning-effort-thumb")).toHaveStyle({
			borderColor: "var(--vscode-editor-foreground)",
			boxShadow:
				"0 0 0 2px var(--vscode-editor-background), 0 0 0 4px color-mix(in srgb, var(--vscode-button-background) 38%, transparent), 0 0 10px color-mix(in srgb, var(--vscode-button-background) 45%, transparent)",
		})
		expect(screen.getByTestId("reasoning-effort-progress").className).toContain("rounded-full")
		expect(activeTick).toHaveStyle({ left: "50%" })
		expect(thumb).toHaveStyle({ left: "calc(50% - 14px)" })
		expect(screen.getByTestId("reasoning-effort-rail").className).toContain("h-9")
		expect(activeTick.className).toContain("z-10")
		expect(thumb.className).toContain("z-20")
	})

	it("previews pointer changes without saving until the pointer is released", () => {
		render(<ReasoningEffortSlider {...defaultProps} />)
		const rail = screen.getByTestId("reasoning-effort-rail")
		setRailDimensions(rail)

		firePointerEvent(rail, "pointerDown", 210)

		expect(screen.getByTestId("reasoning-effort-value")).toHaveTextContent(
			"settings:providers.reasoningEffort.high",
		)
		expect(screen.getByTestId("reasoning-effort-thumb")).toHaveStyle({ left: "calc(100% - 32px)" })
		expect(defaultProps.onCommit).not.toHaveBeenCalled()

		firePointerEvent(rail, "pointerUp", 210)
		expect(defaultProps.onCommit).toHaveBeenCalledWith({ enableReasoningEffort: true, reasoningEffort: "high" })
		expect(screen.getByTestId("reasoning-effort-progress")).toHaveStyle({ width: "100%" })
	})

	it("uses a lighter gradient start in a light VS Code theme", () => {
		document.body.dataset.vscodeThemeKind = "vscode-light"
		render(<ReasoningEffortSlider {...defaultProps} />)

		expect(screen.getByTestId("reasoning-effort-progress")).toHaveStyle({
			backgroundImage:
				"linear-gradient(90deg, color-mix(in srgb, var(--vscode-button-background) 70%, white), var(--vscode-button-background))",
		})
	})

	it("uses distinct bright blue and cyan colors for the highest reasoning tiers", () => {
		const { rerender } = render(
			<ReasoningEffortSlider
				{...defaultProps}
				apiConfiguration={{
					apiProvider: "openai",
					enableReasoningEffort: true,
					openAiCustomModelInfo: {
						contextWindow: 128_000,
						supportsPromptCache: true,
						reasoningEffort: "max",
					},
				}}
			/>,
		)

		expect(screen.getByTestId("reasoning-effort-progress")).toHaveStyle({
			backgroundImage: "linear-gradient(90deg, color-mix(in srgb, #3b82f6 78%, black), #3b82f6)",
		})

		rerender(
			<ReasoningEffortSlider
				{...defaultProps}
				apiConfiguration={{
					apiProvider: "openai",
					enableReasoningEffort: true,
					openAiCustomModelInfo: {
						contextWindow: 128_000,
						supportsPromptCache: true,
						reasoningEffort: "xhigh",
					},
				}}
			/>,
		)
		expect(screen.getByTestId("reasoning-effort-progress")).toHaveStyle({
			backgroundImage: "linear-gradient(90deg, color-mix(in srgb, #06b6d4 78%, black), #06b6d4)",
		})
	})

	it("shows off and resets progress when reasoning is not enabled despite a stored effort", () => {
		render(
			<ReasoningEffortSlider
				{...defaultProps}
				apiConfiguration={{
					apiProvider: "openai-native",
					enableReasoningEffort: false,
					reasoningEffort: "low",
				}}
			/>,
		)

		expect(screen.getByTestId("reasoning-effort-value")).toHaveTextContent("chat:apiConfigSelector.reasoningOff")
		expect(screen.getByTestId("reasoning-effort-progress")).toHaveStyle({ width: "0%" })
	})

	it("commits discrete keyboard changes without a transient overlay", () => {
		render(<ReasoningEffortSlider {...defaultProps} />)
		const rail = screen.getByTestId("reasoning-effort-rail")

		fireEvent.keyDown(rail, { key: "ArrowRight" })

		expect(screen.getByTestId("reasoning-effort-control")).not.toHaveAttribute("data-updating")
		expect(defaultProps.onCommit).toHaveBeenCalledWith({ enableReasoningEffort: true, reasoningEffort: "high" })
	})

	it("only reveals decorative progress patterns at the higher reasoning tiers", () => {
		const { rerender } = render(<ReasoningEffortSlider {...defaultProps} />)
		expect(screen.queryByTestId("reasoning-effort-pattern")).not.toBeInTheDocument()

		rerender(
			<ReasoningEffortSlider
				{...defaultProps}
				apiConfiguration={{
					apiProvider: "openai",
					enableReasoningEffort: true,
					openAiCustomModelInfo: {
						contextWindow: 128_000,
						supportsPromptCache: true,
						reasoningEffort: "xhigh",
					},
				}}
			/>,
		)
		expect(screen.getByTestId("reasoning-effort-pattern")).toHaveStyle({ backgroundSize: "60px 38px" })

		rerender(
			<ReasoningEffortSlider
				{...defaultProps}
				apiConfiguration={{
					apiProvider: "openai",
					enableReasoningEffort: true,
					openAiCustomModelInfo: {
						contextWindow: 128_000,
						supportsPromptCache: true,
						reasoningEffort: "max",
					},
				}}
			/>,
		)
		expect(screen.getByTestId("reasoning-effort-pattern")).toHaveStyle({ backgroundSize: "76px 38px" })
	})

	it("does not save when a pointer drag finishes at its original value", () => {
		render(<ReasoningEffortSlider {...defaultProps} />)
		const rail = screen.getByTestId("reasoning-effort-rail")
		setRailDimensions(rail)

		firePointerEvent(rail, "pointerDown", 110)
		firePointerEvent(rail, "pointerUp", 110)

		expect(defaultProps.onCommit).not.toHaveBeenCalled()
	})

	it("cancels an active pointer drag when Escape is pressed", () => {
		render(<ReasoningEffortSlider {...defaultProps} />)
		const rail = screen.getByTestId("reasoning-effort-rail")
		setRailDimensions(rail)

		firePointerEvent(rail, "pointerDown", 210)
		fireEvent.keyDown(window, { key: "Escape" })
		firePointerEvent(rail, "pointerUp", 210)

		expect(screen.getByTestId("reasoning-effort-thumb")).toHaveStyle({ left: "calc(50% - 14px)" })
		expect(defaultProps.onCommit).not.toHaveBeenCalled()
	})

	it("maps binary reasoning models to an on/off control without rewriting stored effort", () => {
		const onCommit = vi.fn()
		render(
			<ReasoningEffortSlider
				{...defaultProps}
				apiConfiguration={{ apiProvider: "anthropic", enableReasoningEffort: false, reasoningEffort: "high" }}
				modelInfo={{ contextWindow: 128_000, supportsPromptCache: true, supportsReasoningBinary: true }}
				onCommit={onCommit}
			/>,
		)

		fireEvent.keyDown(screen.getByTestId("reasoning-effort-rail"), { key: "ArrowRight" })
		expect(onCommit).toHaveBeenCalledWith({ enableReasoningEffort: true, reasoningEffort: undefined })
	})

	it("supports OpenAI Compatible profiles and persists the effort in custom model metadata", () => {
		const onCommit = vi.fn()
		render(
			<ReasoningEffortSlider
				{...defaultProps}
				apiConfiguration={{
					apiProvider: "openai",
					enableReasoningEffort: true,
					openAiCustomModelInfo: {
						contextWindow: 128_000,
						supportsPromptCache: true,
						reasoningEffort: "high",
					},
				}}
				onCommit={onCommit}
			/>,
		)

		fireEvent.keyDown(screen.getByTestId("reasoning-effort-rail"), { key: "ArrowRight" })
		expect(onCommit).toHaveBeenCalledWith({
			enableReasoningEffort: true,
			openAiCustomModelInfo: {
				contextWindow: 128_000,
				supportsPromptCache: true,
				reasoningEffort: "xhigh",
			},
		})
	})

	it("disables the custom rail and reports unavailable reasoning when the model has no reasoning capability", () => {
		render(
			<ReasoningEffortSlider
				{...defaultProps}
				modelInfo={{ contextWindow: 128_000, supportsPromptCache: true }}
			/>,
		)

		const rail = screen.getByTestId("reasoning-effort-rail")
		expect(rail).toHaveAttribute("tabindex", "-1")
		expect(screen.getByTestId("reasoning-effort-value")).toHaveTextContent(
			"chat:apiConfigSelector.reasoningUnavailable",
		)
	})
})
