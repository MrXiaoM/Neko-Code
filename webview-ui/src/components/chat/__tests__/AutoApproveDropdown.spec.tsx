import type React from "react"

import { render, screen } from "@/utils/test-utils"

import { AutoApproveDropdown } from "../AutoApproveDropdown"

const { translate } = vi.hoisted(() => ({
	translate: vi.fn((key: string) => key),
}))

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: translate }),
}))

vi.mock("@/components/ui/hooks/useRooPortal", () => ({
	useRooPortal: () => document.body,
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		autoApprovalEnabled: true,
		setAutoApprovalEnabled: vi.fn(),
		setAlwaysAllowReadOnly: vi.fn(),
		setAlwaysAllowWrite: vi.fn(),
		setAlwaysAllowExecute: vi.fn(),
		setAlwaysAllowMcp: vi.fn(),
		setAlwaysAllowModeSwitch: vi.fn(),
		setAlwaysAllowSubtasks: vi.fn(),
		setAlwaysAllowFollowupQuestions: vi.fn(),
	}),
}))

vi.mock("@/hooks/useAutoApprovalToggles", () => ({
	useAutoApprovalToggles: () => ({
		alwaysAllowReadOnly: false,
		alwaysAllowWrite: false,
		alwaysAllowExecute: false,
		alwaysAllowMcp: false,
		alwaysAllowModeSwitch: false,
		alwaysAllowSubtasks: false,
		alwaysAllowFollowupQuestions: false,
	}),
}))

vi.mock("@/hooks/useAutoApprovalState", () => ({
	useAutoApprovalState: () => ({ effectiveAutoApprovalEnabled: true }),
}))

vi.mock("@/components/ui", () => ({
	Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	PopoverTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
	StandardTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	ToggleSwitch: (props: React.ComponentProps<"button">) => <button role="switch" {...props} />,
	Button: ({ children, ...props }: React.ComponentProps<"button">) => <button {...props}>{children}</button>,
}))

describe("AutoApproveDropdown", () => {
	beforeEach(() => {
		translate.mockClear()
	})

	it("localizes the bottom auto-approval status and toggle label", () => {
		render(<AutoApproveDropdown />)

		expect(translate).toHaveBeenCalledWith("settings:autoApprove.enabled")
		expect(translate).toHaveBeenCalledWith("settings:autoApprove.toggleAriaLabel")
		expect(screen.getByRole("switch")).toHaveAttribute("aria-label", "settings:autoApprove.toggleAriaLabel")
		expect(screen.getByText("settings:autoApprove.enabled")).toBeInTheDocument()
	})
})
