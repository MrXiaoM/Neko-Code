import { render, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { UISettings } from "../UISettings"
import { telemetryClient } from "@/utils/TelemetryClient"

vi.mock("@/utils/TelemetryClient", () => ({
	telemetryClient: { capture: vi.fn() },
}))

describe("UISettings", () => {
	const defaultProps = {
		reasoningBlockCollapsed: false,
		enterBehavior: "send" as const,
		onSelectUserAvatar: vi.fn(),
		onClearUserAvatar: vi.fn(),
		setCachedStateField: vi.fn(),
	}

	it("renders the collapse thinking checkbox", () => {
		const { getByTestId } = render(<UISettings {...defaultProps} />)
		const checkbox = getByTestId("collapse-thinking-checkbox")
		expect(checkbox).toBeTruthy()
	})

	it("displays the correct initial state", () => {
		const { getByTestId } = render(<UISettings {...defaultProps} reasoningBlockCollapsed={true} />)
		const checkbox = getByTestId("collapse-thinking-checkbox") as HTMLInputElement
		expect(checkbox.checked).toBe(true)
	})

	it("calls setCachedStateField when checkbox is toggled", async () => {
		const setCachedStateField = vi.fn()
		const { getByTestId } = render(<UISettings {...defaultProps} setCachedStateField={setCachedStateField} />)

		const checkbox = getByTestId("collapse-thinking-checkbox")
		fireEvent.click(checkbox)

		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("reasoningBlockCollapsed", true)
		})
	})

	it("updates checkbox state when prop changes", () => {
		const { getByTestId, rerender } = render(<UISettings {...defaultProps} reasoningBlockCollapsed={false} />)
		const checkbox = getByTestId("collapse-thinking-checkbox") as HTMLInputElement
		expect(checkbox.checked).toBe(false)

		rerender(<UISettings {...defaultProps} reasoningBlockCollapsed={true} />)
		expect(checkbox.checked).toBe(true)
	})

	describe("chat font size", () => {
		it("shows the default font size when unset (init)", () => {
			const { getByText, getByTestId } = render(<UISettings {...defaultProps} chatFontSize={undefined} />)
			expect(getByTestId("chat-font-size-slider")).toBeTruthy()
			// Default falls back to VS Code-equivalent default value.
			expect(getByText("13px")).toBeTruthy()
		})

		it("shows the configured font size when set", () => {
			const { getByText } = render(<UISettings {...defaultProps} chatFontSize={20} />)
			expect(getByText("20px")).toBeTruthy()
		})

		it("persists a user-edited font size via setCachedStateField", () => {
			const setCachedStateField = vi.fn()
			const { getByTestId } = render(
				<UISettings {...defaultProps} chatFontSize={14} setCachedStateField={setCachedStateField} />,
			)

			const slider = getByTestId("chat-font-size-slider").querySelector('[role="slider"]') as HTMLElement
			slider.focus()
			fireEvent.keyDown(slider, { key: "ArrowRight" })

			expect(setCachedStateField).toHaveBeenCalledWith("chatFontSize", 15)
			expect(telemetryClient.capture).toHaveBeenCalledWith("ui_settings_chat_font_size_changed", { value: 15 })
		})

		it("disables reset when unset and clears the value on reset", () => {
			const setCachedStateField = vi.fn()
			const { getByTestId, rerender } = render(
				<UISettings {...defaultProps} chatFontSize={undefined} setCachedStateField={setCachedStateField} />,
			)

			const resetUnset = getByTestId("chat-font-size-reset") as HTMLButtonElement
			expect(resetUnset.disabled).toBe(true)

			rerender(<UISettings {...defaultProps} chatFontSize={18} setCachedStateField={setCachedStateField} />)
			const resetSet = getByTestId("chat-font-size-reset") as HTMLButtonElement
			expect(resetSet.disabled).toBe(false)

			fireEvent.click(resetSet)
			expect(setCachedStateField).toHaveBeenCalledWith("chatFontSize", undefined)
			expect(telemetryClient.capture).toHaveBeenCalledWith("ui_settings_chat_font_size_reset")
		})
	})

	describe("user avatar", () => {
		it("is hidden until the dedicated AI IDE layout draft is enabled", () => {
			const { queryByTestId } = render(<UISettings {...defaultProps} dedicatedIdeLayoutEnabled={false} />)

			expect(queryByTestId("select-user-avatar-button")).not.toBeInTheDocument()
		})

		it("requests a local avatar picker through the settings draft callback", () => {
			const onSelectUserAvatar = vi.fn()
			const { getByTestId } = render(
				<UISettings
					{...defaultProps}
					dedicatedIdeLayoutEnabled={true}
					onSelectUserAvatar={onSelectUserAvatar}
				/>,
			)

			fireEvent.click(getByTestId("select-user-avatar-button"))
			expect(onSelectUserAvatar).toHaveBeenCalledOnce()
		})

		it("shows a pending-save selection status and disables repeated picks", () => {
			const { getByTestId } = render(
				<UISettings
					{...defaultProps}
					dedicatedIdeLayoutEnabled={true}
					isSelectingUserAvatar={true}
					userAvatarSelectionMessage="Image selected. Click Save to apply it."
				/>,
			)

			expect(getByTestId("select-user-avatar-button")).toBeDisabled()
			expect(getByTestId("user-avatar-selection-status")).toHaveTextContent(
				"Image selected. Click Save to apply it.",
			)
		})

		it("shows the selected avatar and requests draft removal", () => {
			const onClearUserAvatar = vi.fn()
			const { getByTestId } = render(
				<UISettings
					{...defaultProps}
					dedicatedIdeLayoutEnabled={true}
					userAvatarUrl="vscode-webview://avatar.png"
					onClearUserAvatar={onClearUserAvatar}
				/>,
			)

			expect(getByTestId("select-user-avatar-button")).toHaveTextContent("settings:ui.userAvatar.change")
			fireEvent.click(getByTestId("clear-user-avatar-button"))
			expect(onClearUserAvatar).toHaveBeenCalledOnce()
		})
	})

	describe("dedicated AI IDE layout", () => {
		it("uses the cached layout preference and updates only the cached setting", () => {
			const setCachedStateField = vi.fn()
			const { getByTestId } = render(
				<UISettings
					{...defaultProps}
					dedicatedIdeLayoutEnabled={false}
					setCachedStateField={setCachedStateField}
				/>,
			)

			const checkbox = getByTestId("dedicated-ide-layout-checkbox") as HTMLInputElement
			expect(checkbox.checked).toBe(false)
			fireEvent.click(checkbox)
			expect(setCachedStateField).toHaveBeenCalledWith("dedicatedIdeLayoutEnabled", true)
		})
	})

	describe("auto-close Zoo-opened files checkboxes", () => {
		it("renders all three auto-close checkboxes", () => {
			const { getByTestId } = render(
				<UISettings
					{...defaultProps}
					autoCloseZooOpenedFiles={true}
					autoCloseZooOpenedFilesAfterUserEdited={false}
					autoCloseZooOpenedNewFiles={false}
				/>,
			)
			expect(getByTestId("auto-close-zoo-opened-files-checkbox")).toBeTruthy()
			expect(getByTestId("auto-close-zoo-opened-files-after-user-edited-checkbox")).toBeTruthy()
			expect(getByTestId("auto-close-zoo-opened-new-files-checkbox")).toBeTruthy()
		})

		it("autoCloseZooOpenedFiles checkbox reflects true prop", () => {
			const { getByTestId } = render(<UISettings {...defaultProps} autoCloseZooOpenedFiles={true} />)
			const checkbox = getByTestId("auto-close-zoo-opened-files-checkbox") as HTMLInputElement
			expect(checkbox.checked).toBe(true)
		})

		it("autoCloseZooOpenedFiles checkbox reflects false prop", () => {
			const { getByTestId } = render(<UISettings {...defaultProps} autoCloseZooOpenedFiles={false} />)
			const checkbox = getByTestId("auto-close-zoo-opened-files-checkbox") as HTMLInputElement
			expect(checkbox.checked).toBe(false)
		})

		it("autoCloseZooOpenedFiles checkbox defaults to unchecked when prop is unset", () => {
			// Omitting the prop simulates the opt-in default (false). A regression that
			// flips the fallback back to `?? true` would make this checkbox checked.
			const { getByTestId } = render(<UISettings {...defaultProps} />)
			const checkbox = getByTestId("auto-close-zoo-opened-files-checkbox") as HTMLInputElement
			expect(checkbox.checked).toBe(false)
		})

		it("calls setCachedStateField with autoCloseZooOpenedFiles when toggled", async () => {
			const setCachedStateField = vi.fn()
			const { getByTestId } = render(
				<UISettings
					{...defaultProps}
					autoCloseZooOpenedFiles={true}
					setCachedStateField={setCachedStateField}
				/>,
			)
			const checkbox = getByTestId("auto-close-zoo-opened-files-checkbox")
			fireEvent.click(checkbox)
			await waitFor(() => {
				expect(setCachedStateField).toHaveBeenCalledWith("autoCloseZooOpenedFiles", false)
			})
		})

		it("calls setCachedStateField with autoCloseZooOpenedFilesAfterUserEdited when toggled", async () => {
			const setCachedStateField = vi.fn()
			const { getByTestId } = render(
				<UISettings
					{...defaultProps}
					autoCloseZooOpenedFilesAfterUserEdited={false}
					setCachedStateField={setCachedStateField}
				/>,
			)
			const checkbox = getByTestId("auto-close-zoo-opened-files-after-user-edited-checkbox")
			fireEvent.click(checkbox)
			await waitFor(() => {
				expect(setCachedStateField).toHaveBeenCalledWith("autoCloseZooOpenedFilesAfterUserEdited", true)
			})
		})

		it("calls setCachedStateField with autoCloseZooOpenedNewFiles when toggled", async () => {
			const setCachedStateField = vi.fn()
			const { getByTestId } = render(
				<UISettings
					{...defaultProps}
					autoCloseZooOpenedNewFiles={false}
					setCachedStateField={setCachedStateField}
				/>,
			)
			const checkbox = getByTestId("auto-close-zoo-opened-new-files-checkbox")
			fireEvent.click(checkbox)
			await waitFor(() => {
				expect(setCachedStateField).toHaveBeenCalledWith("autoCloseZooOpenedNewFiles", true)
			})
		})
	})
})
