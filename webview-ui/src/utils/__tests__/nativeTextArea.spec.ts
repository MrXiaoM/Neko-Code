import { replaceTextAreaValue } from "../nativeTextArea"

describe("replaceTextAreaValue", () => {
	afterEach(() => {
		vi.restoreAllMocks()
		Reflect.deleteProperty(document, "execCommand")
	})

	it("replaces text through the native editing command to preserve undo history", () => {
		const textArea = document.createElement("textarea")
		const focus = vi.fn()
		const select = vi.fn()
		textArea.focus = focus
		textArea.select = select
		const execCommand = vi.fn().mockReturnValue(true)
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: execCommand,
		})

		expect(replaceTextAreaValue(textArea, "replacement")).toBe(true)
		expect(focus).toHaveBeenCalledTimes(1)
		expect(select).toHaveBeenCalledTimes(1)
		expect(execCommand).toHaveBeenCalledWith("insertText", false, "replacement")
	})

	it("returns false when native editing is unavailable", () => {
		Object.defineProperty(document, "execCommand", {
			configurable: true,
			value: undefined,
		})

		expect(replaceTextAreaValue(document.createElement("textarea"), "replacement")).toBe(false)
		expect(replaceTextAreaValue(null, "replacement")).toBe(false)
	})
})
