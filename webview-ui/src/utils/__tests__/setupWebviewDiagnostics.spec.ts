import { setupWebviewDiagnostics } from "../setupWebviewDiagnostics"

const { reportWebviewDiagnostic } = vi.hoisted(() => ({ reportWebviewDiagnostic: vi.fn() }))

vi.mock("../webviewDiagnostics", () => ({
	reportWebviewDiagnostic,
}))

describe("setupWebviewDiagnostics", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("reports global errors without including error contents", () => {
		setupWebviewDiagnostics()

		window.dispatchEvent(new ErrorEvent("error", { error: new Error("sensitive file path") }))

		expect(reportWebviewDiagnostic).toHaveBeenCalledWith("global-error", { hasError: true })
	})

	it("reports unhandled rejections without including rejection contents", () => {
		setupWebviewDiagnostics()

		window.dispatchEvent(new Event("unhandledrejection"))

		expect(reportWebviewDiagnostic).toHaveBeenCalledWith("unhandled-rejection", { hasReason: false })
	})
})
