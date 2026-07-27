import { telemetryClient } from "@src/utils/TelemetryClient"

type DiagnosticStage = "global-error" | "unhandled-rejection" | "extension-message"

/**
 * Reports only non-sensitive webview failure metadata.
 * Error text, stack traces, message payloads, and file paths are intentionally excluded.
 */
export function reportWebviewDiagnostic(stage: DiagnosticStage, details: Record<string, unknown> = {}): void {
	const properties = { stage, ...details }

	console.error("[Zoo Code] Webview diagnostic", properties)
	telemetryClient.capture("webview_diagnostic", properties)
}
