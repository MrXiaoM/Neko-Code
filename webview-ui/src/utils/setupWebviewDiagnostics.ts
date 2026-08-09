import { reportWebviewDiagnostic } from "./webviewDiagnostics"

export function getWebviewErrorDetails(error: unknown): Record<string, string> {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack ?? "",
		}
	}

	return { message: typeof error === "string" ? error : String(error) }
}

export function setupWebviewDiagnostics(): void {
	window.addEventListener("error", (event) => {
		reportWebviewDiagnostic("global-error", getWebviewErrorDetails(event.error))
	})

	window.addEventListener("unhandledrejection", (event) => {
		reportWebviewDiagnostic("unhandled-rejection", getWebviewErrorDetails(event.reason))
	})
}
