import React, { Component } from "react"
import { telemetryClient } from "@src/utils/TelemetryClient"
import { withTranslation, WithTranslation } from "react-i18next"
import { enhanceErrorWithSourceMaps } from "@src/utils/sourceMapUtils"
import { reportWebviewDiagnostic } from "@src/utils/webviewDiagnostics"
import { EXTERNAL_LINKS } from "@src/constants/externalLinks"

type ErrorProps = {
	children: React.ReactNode
} & WithTranslation

type ErrorState = {
	error?: string
	componentStack?: string | null
	timestamp?: number
}

class ErrorBoundary extends Component<ErrorProps, ErrorState> {
	constructor(props: ErrorProps) {
		super(props)
		this.state = {}
	}

	static getDerivedStateFromError(error: unknown) {
		let errorMessage = ""

		if (error instanceof Error) {
			errorMessage = error.stack ?? error.message
		} else {
			errorMessage = `${error}`
		}

		return {
			error: errorMessage,
			timestamp: Date.now(),
		}
	}

	async componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		const componentStack = errorInfo.componentStack || ""

		// Persist the crash before source-map enhancement so a secondary enhancement failure
		// cannot hide the original Webview failure from automatic local diagnostics.
		reportWebviewDiagnostic("error-boundary", {
			name: error.name,
			message: error.message,
			stack: error.stack,
			componentStack,
		})

		const enhancedError = await enhanceErrorWithSourceMaps(error, componentStack)
		const stack = enhancedError.sourceMappedStack || enhancedError.stack
		const sourceMappedComponentStack = enhancedError.sourceMappedComponentStack || componentStack

		telemetryClient.capture("error_boundary_caught_error", {
			error: enhancedError.message,
			stack,
			componentStack: sourceMappedComponentStack,
			timestamp: Date.now(),
			errorType: enhancedError.name,
		})

		this.setState({
			error: stack,
			componentStack: sourceMappedComponentStack,
		})
	}

	render() {
		const { t } = this.props

		if (!this.state.error) {
			return this.props.children
		}

		const errorDisplay = this.state.error
		const componentStackDisplay = this.state.componentStack

		const version = process.env.PKG_VERSION || "unknown"

		return (
			<div>
				<h2 className="text-lg font-bold mt-0 mb-2">
					{t("errorBoundary.title")} (v{version})
				</h2>
				<p className="mb-4">
					{t("errorBoundary.reportText")}{" "}
					<a href={EXTERNAL_LINKS.GITHUB_ISSUES} target="_blank" rel="noreferrer">
						{t("errorBoundary.githubText")}
					</a>
				</p>
				<p className="mb-2">{t("errorBoundary.copyInstructions")}</p>

				<div className="mb-4">
					<h3 className="text-md font-bold mb-1">{t("errorBoundary.errorStack")}</h3>
					<pre className="p-2 border rounded text-sm overflow-auto">{errorDisplay}</pre>
				</div>

				{componentStackDisplay && (
					<div>
						<h3 className="text-md font-bold mb-1">{t("errorBoundary.componentStack")}</h3>
						<pre className="p-2 border rounded text-sm overflow-auto">{componentStackDisplay}</pre>
					</div>
				)}
			</div>
		)
	}
}

export default withTranslation("common")(ErrorBoundary)
