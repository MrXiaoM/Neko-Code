import { fireEvent, render, screen } from "@/utils/test-utils"

import { vscode } from "@src/utils/vscode"
import { NotificationSettings } from "../NotificationSettings"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
	VSCodeTextField: ({
		value,
		onInput,
	}: {
		value: string
		onInput: (event: React.ChangeEvent<HTMLInputElement>) => void
	}) => <input value={value} onChange={onInput} />,
}))

describe("NotificationSettings Neko Notifier reload", () => {
	const setCachedStateField = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("requests the current service status and reloads the configured connection", () => {
		render(
			<NotificationSettings
				nekoNotifierDataDirectory="C:/Users/test/AppData/Local/NekoNotifier"
				setCachedStateField={setCachedStateField}
			/>,
		)

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "requestNekoNotifierStatus" })

		fireEvent.click(screen.getByTestId("reload-neko-notifier-button"))

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "reloadNekoNotifier" })
	})

	it("displays an active status returned by the extension", () => {
		render(<NotificationSettings setCachedStateField={setCachedStateField} />)

		fireEvent(window, new MessageEvent("message", { data: { type: "nekoNotifierStatus", active: true } }))

		expect(screen.getByTestId("neko-notifier-status")).toHaveTextContent(
			"settings:notifications.nekoNotifier.status.active",
		)
	})

	it("disables reloading when no data directory is configured", () => {
		render(<NotificationSettings setCachedStateField={setCachedStateField} />)

		expect(screen.getByTestId("reload-neko-notifier-button")).toBeDisabled()
	})
})
