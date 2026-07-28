import { render } from "@/utils/test-utils"

import TranslationProvider, { useAppTranslation } from "../TranslationContext"

const { translate, i18n } = vi.hoisted(() => {
	const translate = (key: string, options?: Record<string, any>) => {
		if (key === "settings.autoApprove.title") return "Auto-Approve"
		if (key === "notifications.error") {
			return options?.message ? `Operation failed: ${options.message}` : "Operation failed"
		}
		return key
	}

	return {
		translate,
		i18n: {
			t: translate,
			changeLanguage: vi.fn(),
		},
	}
})

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		language: "en",
	}),
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: translate, i18n }),
}))

vi.mock("../setup", () => ({
	default: i18n,
	setWebviewAgentName: vi.fn(),
}))

const TestComponent = () => {
	const { t } = useAppTranslation()
	return (
		<div>
			<h1 data-testid="translation-test">{t("settings.autoApprove.title")}</h1>
			<p data-testid="translation-interpolation">{t("notifications.error", { message: "Test error" })}</p>
		</div>
	)
}

let providedTranslate: typeof translate | undefined

const TranslationReferenceProbe = () => {
	providedTranslate = useAppTranslation().t
	return null
}

describe("TranslationContext", () => {
	it("should provide translations via context", () => {
		const { getByTestId } = render(
			<TranslationProvider>
				<TestComponent />
			</TranslationProvider>,
		)

		// Check if translation is provided correctly
		expect(getByTestId("translation-test")).toHaveTextContent("Auto-Approve")
	})

	it("provides the translation function subscribed by react-i18next", () => {
		render(
			<TranslationProvider>
				<TranslationReferenceProbe />
			</TranslationProvider>,
		)

		expect(providedTranslate).toBe(translate)
	})

	it("should handle interpolation correctly", () => {
		const { getByTestId } = render(
			<TranslationProvider>
				<TestComponent />
			</TranslationProvider>,
		)

		// Check if interpolation works
		expect(getByTestId("translation-interpolation")).toHaveTextContent("Operation failed: Test error")
	})
})
