import { telemetryClient } from "@src/utils/TelemetryClient"
import { vscode } from "@src/utils/vscode"

type DiagnosticStage = "global-error" | "unhandled-rejection" | "extension-message" | "error-boundary"

type WebviewCrashStage = Exclude<DiagnosticStage, "extension-message">

type CrashDetails = {
	name?: string
	message?: string
	stack?: string
	componentStack?: string
}

const MAX_DIAGNOSTIC_FIELD_LENGTH = 12_000

function truncate(value: string | undefined): string | undefined {
	return value && value.length > MAX_DIAGNOSTIC_FIELD_LENGTH
		? `${value.slice(0, MAX_DIAGNOSTIC_FIELD_LENGTH)}…`
		: value
}

function toCrashDetails(details: Record<string, unknown>): CrashDetails {
	return {
		name: typeof details.name === "string" ? truncate(details.name) : undefined,
		message: typeof details.message === "string" ? truncate(details.message) : undefined,
		stack: typeof details.stack === "string" ? truncate(details.stack) : undefined,
		componentStack: typeof details.componentStack === "string" ? truncate(details.componentStack) : undefined,
	}
}

/**
 * Reports lightweight metadata to telemetry and automatically sends Webview crashes to the
 * extension host for durable local logging. This path must remain independent of UI rendering.
 */
export function reportWebviewDiagnostic(stage: DiagnosticStage, details: Record<string, unknown> = {}): void {
	const properties = { stage, ...details }

	console.error("[Zoo Code] Webview diagnostic", properties)
	telemetryClient.capture("webview_diagnostic", properties)

	if (stage !== "extension-message") {
		vscode.postMessage({
			type: "webviewCrash",
			webviewCrash: { stage: stage as WebviewCrashStage, ...toCrashDetails(details) },
		})
	}
}
