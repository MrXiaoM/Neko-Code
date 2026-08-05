export function replaceTextAreaValue(textArea: HTMLTextAreaElement | null, value: string): boolean {
	if (!textArea || typeof document.execCommand !== "function") {
		return false
	}

	textArea.focus()
	textArea.select()
	return document.execCommand("insertText", false, value)
}
