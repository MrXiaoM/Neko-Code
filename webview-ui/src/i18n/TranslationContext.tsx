import React, { createContext, useContext, ReactNode, useEffect } from "react"
import { useTranslation } from "react-i18next"
import i18next, { setWebviewAgentName } from "./setup"
import { useExtensionState } from "@/context/ExtensionStateContext"

// Create context for translations
export const TranslationContext = createContext<{
	t: (key: string, options?: Record<string, any>) => string
	i18n: typeof i18next
}>({
	t: (key: string) => key,
	i18n: i18next,
})

// Translation provider component
export const TranslationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
	// `t` is subscribed to i18next language changes by react-i18next.
	const { t, i18n } = useTranslation()
	// Get the extension state directly - it already contains all state properties
	const extensionState = useExtensionState()

	useEffect(() => {
		i18n.changeLanguage(extensionState.language)
	}, [i18n, extensionState.language])

	// Sync agentName to the i18n post-processor so {{agentName}} in translations is replaced
	useEffect(() => {
		setWebviewAgentName(extensionState.agentName || "Mirai")
	}, [extensionState.agentName])

	return (
		<TranslationContext.Provider
			value={{
				t,
				i18n,
			}}>
			{children}
		</TranslationContext.Provider>
	)
}

// Custom hook for easy translations
export const useAppTranslation = () => useContext(TranslationContext)

export default TranslationProvider
