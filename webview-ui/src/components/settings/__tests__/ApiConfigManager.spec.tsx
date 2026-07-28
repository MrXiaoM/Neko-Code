// npx vitest src/components/settings/__tests__/ApiConfigManager.spec.tsx

import { render, screen, fireEvent, within } from "@/utils/test-utils"

import ApiConfigManager from "../ApiConfigManager"

// Mock VSCode components
vitest.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ value, onInput, placeholder, onKeyDown, "data-testid": dataTestId }: any) => (
		<input
			value={value}
			onChange={(e) => onInput(e)}
			placeholder={placeholder}
			onKeyDown={onKeyDown}
			data-testid={dataTestId}
			ref={undefined} // Explicitly set ref to undefined to avoid warning
		/>
	),
}))

vitest.mock("@/components/ui", () => ({
	...vitest.importActual("@/components/ui"),
	Dialog: ({ children, open }: any) =>
		open ? (
			<div role="dialog" aria-modal="true" data-testid="dialog">
				{children}
			</div>
		) : null,
	DialogContent: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
	DialogTitle: ({ children }: any) => <div data-testid="dialog-title">{children}</div>,
	Button: ({ children, onClick, disabled, "data-testid": dataTestId }: any) => (
		<button onClick={onClick} disabled={disabled} data-testid={dataTestId}>
			{children}
		</button>
	),
	Input: ({ value, onInput, placeholder, onKeyDown, "data-testid": dataTestId }: any) => (
		<input
			value={value}
			onChange={(e) => onInput(e)}
			placeholder={placeholder}
			onKeyDown={onKeyDown}
			data-testid={dataTestId}
		/>
	),
	StandardTooltip: ({ children, content }: any) => <div title={content}>{children}</div>,
	// New components for searchable dropdown
	Popover: ({ children, open }: any) => (
		<div className="popover" style={{ position: "relative" }}>
			{children}
			{open && <div className="popover-content" style={{ position: "absolute", top: "100%", left: 0 }}></div>}
		</div>
	),
	PopoverTrigger: ({ children }: any) => <div className="popover-trigger">{children}</div>,
	PopoverContent: ({ children }: any) => <div className="popover-content">{children}</div>,
	Command: ({ children }: any) => <div className="command">{children}</div>,
	CommandInput: ({ value, onValueChange, placeholder, className, "data-testid": dataTestId }: any) => (
		<input
			value={value}
			onChange={(e) => onValueChange(e.target.value)}
			placeholder={placeholder}
			className={className}
			data-testid={dataTestId}
		/>
	),
	CommandList: ({ children }: any) => <div className="command-list">{children}</div>,
	CommandEmpty: ({ children }: any) => (children ? <div className="command-empty">{children}</div> : null),
	CommandGroup: ({ children }: any) => <div className="command-group">{children}</div>,
	CommandItem: ({ children, value, onSelect }: any) => (
		<div className="command-item" onClick={() => onSelect(value)} data-value={value}>
			{children}
		</div>
	),
	// Keep old components for backward compatibility
	Select: ({ value, onValueChange }: any) => (
		<select
			value={value}
			onChange={(e) => {
				if (onValueChange) onValueChange(e.target.value)
			}}
			data-testid="select-component">
			<option value="Default Config">Default Config</option>
			<option value="Another Config">Another Config</option>
		</select>
	),
	SelectTrigger: ({ children }: any) => <div className="select-trigger-mock">{children}</div>,
	SelectValue: ({ children }: any) => <div className="select-value-mock">{children}</div>,
	SelectContent: ({ children }: any) => <div className="select-content-mock">{children}</div>,
	SelectItem: ({ children, value }: any) => (
		<option value={value} className="select-item-mock">
			{children}
		</option>
	),
	SearchableSelect: ({
		value,
		onValueChange,
		options,
		placeholder,
		listMaxHeight,
		nativeWheel,
		"data-testid": dataTestId,
	}: any) => (
		<select
			value={value}
			onChange={(e) => {
				if (onValueChange) onValueChange(e.target.value)
			}}
			data-list-max-height={listMaxHeight}
			data-native-wheel={nativeWheel}
			data-testid={dataTestId || "select-component"}>
			<option value="">{placeholder || "settings:common.select"}</option>
			{options?.map((option: any) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	),
}))

describe("ApiConfigManager", () => {
	const mockOnSelectConfig = vitest.fn()
	const mockOnDeleteConfig = vitest.fn()
	const mockOnRenameConfig = vitest.fn()
	const mockOnUpsertConfig = vitest.fn()
	const mockOnReorderConfigs = vitest.fn()

	const defaultProps = {
		currentApiConfigId: "default",
		currentApiConfigName: "Default Config",
		listApiConfigMeta: [
			{ id: "default", name: "Default Config" },
			{ id: "another", name: "Another Config" },
		],
		onSelectConfig: mockOnSelectConfig,
		onDeleteConfig: mockOnDeleteConfig,
		onRenameConfig: mockOnRenameConfig,
		onUpsertConfig: mockOnUpsertConfig,
		onReorderConfigs: mockOnReorderConfigs,
	}

	beforeEach(() => {
		vitest.clearAllMocks()
	})

	const getRenameForm = () => screen.getByTestId("rename-form")
	const getDialogContent = () => screen.getByTestId("dialog-content")

	it("opens a separate dialog for sorting profiles", () => {
		render(<ApiConfigManager {...defaultProps} />)

		fireEvent.click(screen.getByTestId("sort-profiles-button"))

		expect(screen.getByText("settings:providers.sortProfiles")).toBeInTheDocument()
		expect(screen.getAllByText("Default Config")).toHaveLength(2)
		expect(screen.getAllByText("Another Config")).toHaveLength(2)
	})

	it("opens new profile dialog when clicking add button", () => {
		render(<ApiConfigManager {...defaultProps} />)

		const addButton = screen.getByTestId("add-profile-button")
		fireEvent.click(addButton)

		expect(screen.getByTestId("dialog")).toBeVisible()
		expect(screen.getByTestId("dialog-title")).toHaveTextContent("settings:providers.newProfile")
	})

	it("creates new profile with entered name", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Open dialog
		const addButton = screen.getByTestId("add-profile-button")
		fireEvent.click(addButton)

		// Enter new profile name
		const input = screen.getByTestId("new-profile-input")
		fireEvent.input(input, { target: { value: "New Profile" } })

		// Click create button
		const createButton = screen.getByText("settings:providers.createProfile")
		fireEvent.click(createButton)

		expect(mockOnUpsertConfig).toHaveBeenCalledWith("New Profile")
	})

	it("shows error when creating profile with existing name", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Open dialog
		const addButton = screen.getByTestId("add-profile-button")
		fireEvent.click(addButton)

		// Enter existing profile name
		const input = screen.getByTestId("new-profile-input")
		fireEvent.input(input, { target: { value: "Default Config" } })

		// Click create button to trigger validation
		const createButton = screen.getByText("settings:providers.createProfile")
		fireEvent.click(createButton)

		// Verify error message
		const dialogContent = getDialogContent()
		const errorMessage = within(dialogContent).getByTestId("error-message")
		expect(errorMessage).toHaveTextContent("settings:providers.nameExists")
		expect(mockOnUpsertConfig).not.toHaveBeenCalled()
	})

	it("prevents creating profile with empty name", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Open dialog
		const addButton = screen.getByTestId("add-profile-button")
		fireEvent.click(addButton)

		// Enter empty name
		const input = screen.getByTestId("new-profile-input")
		fireEvent.input(input, { target: { value: "   " } })

		// Verify create button is disabled
		const createButton = screen.getByText("settings:providers.createProfile")
		expect(createButton).toBeDisabled()
		expect(mockOnUpsertConfig).not.toHaveBeenCalled()
	})

	it("allows renaming the current config", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Start rename
		const renameButton = screen.getByTestId("rename-profile-button")
		fireEvent.click(renameButton)

		// Find input and enter new name
		const input = screen.getByDisplayValue("Default Config")
		fireEvent.input(input, { target: { value: "New Name" } })

		// Save
		const saveButton = screen.getByTestId("save-rename-button")
		fireEvent.click(saveButton)

		expect(mockOnRenameConfig).toHaveBeenCalledWith("default", "New Name")
	})

	it("shows error when renaming to existing config name", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Start rename
		const renameButton = screen.getByTestId("rename-profile-button")
		fireEvent.click(renameButton)

		// Find input and enter existing name
		const input = screen.getByDisplayValue("Default Config")
		fireEvent.input(input, { target: { value: "Another Config" } })

		// Save to trigger validation
		const saveButton = screen.getByTestId("save-rename-button")
		fireEvent.click(saveButton)

		// Verify error message
		const renameForm = getRenameForm()
		const errorMessage = within(renameForm).getByTestId("error-message")
		expect(errorMessage).toHaveTextContent("settings:providers.nameExists")
		expect(mockOnRenameConfig).not.toHaveBeenCalled()
	})

	it("prevents renaming to empty name", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Start rename
		const renameButton = screen.getByTestId("rename-profile-button")
		fireEvent.click(renameButton)

		// Find input and enter empty name
		const input = screen.getByDisplayValue("Default Config")
		fireEvent.input(input, { target: { value: "   " } })

		// Verify save button is disabled
		const saveButton = screen.getByTestId("save-rename-button")
		expect(saveButton).toBeDisabled()
		expect(mockOnRenameConfig).not.toHaveBeenCalled()
	})

	it("configures a taller profile list with native wheel scrolling", () => {
		render(<ApiConfigManager {...defaultProps} />)

		const selectElement = screen.getByTestId("select-component")
		expect(selectElement).toHaveAttribute("data-list-max-height", "min(520px, calc(100vh - 220px))")
		expect(selectElement).toHaveAttribute("data-native-wheel", "true")
	})

	it("allows selecting a different config", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// The SearchableSelect mock renders as a simple select element
		const selectElement = screen.getByTestId("select-component") as HTMLSelectElement

		// Change the select value to the immutable profile ID.
		fireEvent.change(selectElement, { target: { value: "another" } })

		expect(mockOnSelectConfig).toHaveBeenCalledWith("another")
	})

	it("allows deleting the current config when not the only one", () => {
		render(<ApiConfigManager {...defaultProps} />)

		const deleteButton = screen.getByTestId("delete-profile-button")
		expect(deleteButton).not.toBeDisabled()

		fireEvent.click(deleteButton)
		expect(mockOnDeleteConfig).toHaveBeenCalledWith("default")
	})

	it("disables delete button when only one config exists", () => {
		render(<ApiConfigManager {...defaultProps} listApiConfigMeta={[{ id: "default", name: "Default Config" }]} />)

		const deleteButton = screen.getByTestId("delete-profile-button")
		expect(deleteButton).toHaveAttribute("disabled")
	})

	it("cancels rename operation when clicking cancel", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Start rename
		const renameButton = screen.getByTestId("rename-profile-button")
		fireEvent.click(renameButton)

		// Find input and enter new name
		const input = screen.getByDisplayValue("Default Config")
		fireEvent.input(input, { target: { value: "New Name" } })

		// Cancel
		const cancelButton = screen.getByTestId("cancel-rename-button")
		fireEvent.click(cancelButton)

		// Verify rename was not called
		expect(mockOnRenameConfig).not.toHaveBeenCalled()

		// Verify we're back to normal view
		expect(screen.queryByDisplayValue("New Name")).not.toBeInTheDocument()
	})

	it("handles keyboard events in new profile dialog", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Open dialog
		const addButton = screen.getByTestId("add-profile-button")
		fireEvent.click(addButton)

		const input = screen.getByTestId("new-profile-input")

		// Test Enter key
		fireEvent.input(input, { target: { value: "New Profile" } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(mockOnUpsertConfig).toHaveBeenCalledWith("New Profile")

		// Test Escape key
		fireEvent.keyDown(input, { key: "Escape" })
		expect(screen.queryByTestId("new-profile-input")).not.toBeInTheDocument()
	})

	it("handles keyboard events in rename mode", () => {
		render(<ApiConfigManager {...defaultProps} />)

		// Start rename
		const renameButton = screen.getByTestId("rename-profile-button")
		fireEvent.click(renameButton)

		const input = screen.getByDisplayValue("Default Config")

		// Test Enter key
		fireEvent.input(input, { target: { value: "New Name" } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(mockOnRenameConfig).toHaveBeenCalledWith("default", "New Name")

		// Test Escape key
		fireEvent.keyDown(input, { key: "Escape" })
		expect(screen.queryByDisplayValue("New Name")).not.toBeInTheDocument()
	})
})
