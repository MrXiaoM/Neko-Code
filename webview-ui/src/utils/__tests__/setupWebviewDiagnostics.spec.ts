import { getWebviewErrorDetails } from "../setupWebviewDiagnostics"

describe("getWebviewErrorDetails", () => {
	it("keeps error name, message, and stack for automatic crash logging", () => {
		const error = new Error("input crashed")

		expect(getWebviewErrorDetails(error)).toEqual({
			name: "Error",
			message: "input crashed",
			stack: error.stack,
		})
	})

	it("converts an unhandled rejection reason into a diagnostic message", () => {
		expect(getWebviewErrorDetails("input failed")).toEqual({ message: "input failed" })
	})
})
