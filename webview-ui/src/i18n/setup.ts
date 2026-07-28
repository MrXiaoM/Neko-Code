import i18next from "i18next"
import { initReactI18next } from "react-i18next"

// Build translations object
const translations: Record<string, Record<string, any>> = {}

// Dynamically load locale files
const localeFiles = import.meta.glob("./locales/**/*.json", { eager: true })

// Process all locale files
Object.entries(localeFiles).forEach(([path, module]) => {
	// Extract language and namespace from path
	// Example path: './locales/en/common.json' -> language: 'en', namespace: 'common'
	const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json/)

	if (match) {
		const [, language, namespace] = match

		// Initialize language object if it doesn't exist
		if (!translations[language]) {
			translations[language] = {}
		}

		// Add namespace resources to language
		translations[language][namespace] = (module as any).default || module
	}
})

console.log("Dynamically loaded translations:", Object.keys(translations))

/** Cached agent name for use by the post-processor. Updated at runtime. */
let _webviewAgentName = "Mirai"

/**
 * Register a post-processor that replaces `{{agentName}}` placeholders
 * with the current agent name.  This runs AFTER i18next interpolation,
 * so explicit { agentName: "…" } parameters in t() calls take precedence.
 */
i18next.use({
	type: "postProcessor",
	name: "agentName",
	process: (value: string) => value.replaceAll("{{agentName}}", _webviewAgentName),
})

// Initialize i18next for React with every locale namespace available from the first render.
// TranslationProvider only needs to select the VS Code language at runtime.
i18next.use(initReactI18next).init({
	resources: translations,
	lng: "en", // Default language (will be overridden)
	fallbackLng: "en",
	debug: false,
	interpolation: {
		escapeValue: false, // React already escapes by default
	},
	postProcess: ["agentName"],
})

export function loadTranslations() {
	Object.entries(translations).forEach(([lang, namespaces]) => {
		try {
			Object.entries(namespaces).forEach(([namespace, resources]) => {
				i18next.addResourceBundle(lang, namespace, resources, true, true)
			})
		} catch (error) {
			console.warn(`Could not load ${lang} translations:`, error)
		}
	})
}

/**
 * Update the agent name used by the i18n post-processor.
 * Call this whenever the agent name setting changes.
 */
export function setWebviewAgentName(name: string) {
	_webviewAgentName = name || "Mirai"
}

export default i18next
