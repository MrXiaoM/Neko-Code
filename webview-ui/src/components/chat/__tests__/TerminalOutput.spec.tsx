import { render } from "@testing-library/react"
import { TerminalOutput } from "../TerminalOutput"

describe("TerminalOutput", () => {
	it("renders plain text without ANSI codes", () => {
		const { container } = render(<TerminalOutput content="hello world" />)
		expect(container.textContent).toBe("hello world")
	})

	it("converts ANSI color codes to styled spans", () => {
		const { container } = render(<TerminalOutput content={"\x1B[32mgreen\x1B[0m"} />)
		const span = container.querySelector("span")
		expect(span).toBeTruthy()
		expect(span?.textContent).toBe("green")
	})

	it("preserves ANSI color state from a hidden output prefix", () => {
		const { container } = render(
			<TerminalOutput ansiContext={"\x1B[46mhidden prefix\n"} content="visible preview" />,
		)

		const span = container.querySelector("span")
		expect(span?.textContent).toBe("visible preview")
		expect(span?.getAttribute("style")).toContain("background-color")
	})

	it("escapes HTML in terminal output to prevent XSS", () => {
		const { container } = render(<TerminalOutput content={'<script>alert("xss")</script>'} />)
		expect(container.innerHTML).not.toContain("<script>")
		expect(container.textContent).toContain('<script>alert("xss")</script>')
	})

	it("does not leak an unterminated background color into a subsequent output render", () => {
		const { container, rerender } = render(<TerminalOutput content={"\x1B[46m RUN "} />)

		expect(container.querySelector("span")).toBeTruthy()

		rerender(<TerminalOutput content="plain output" />)

		expect(container.textContent).toBe("plain output")
		expect(container.querySelector("span")).toBeNull()
	})

	it("handles empty content", () => {
		const { container } = render(<TerminalOutput content="" />)
		expect(container.textContent).toBe("")
	})
})
