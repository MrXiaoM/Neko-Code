import { reportWebviewDiagnostic } from "./webviewDiagnostics"

export function setupWebviewDiagnostics(): void {
	window.addEventListener("error", (event) => {
		reportWebviewDiagnostic("global-error", {
			hasError: Boolean(event.error),
		})
	})

	window.addEventListener("unhandledrejection", (event) => {
		reportWebviewDiagnostic("unhandled-rejection", {
			hasReason: event.reason !== undefined,
		})
	})
}
