import { render, screen, waitFor } from "@/utils/test-utils"
import userEvent from "@testing-library/user-event"

import { MiddleTruncatedPath } from "../MiddleTruncatedPath"

describe("MiddleTruncatedPath", () => {
	it("renders the full path when enough space is available", () => {
		render(<MiddleTruncatedPath path="/path/to/file-name.ext" />)

		expect(screen.getByTestId("path-display")).toHaveTextContent("/path/to/file-name.ext")
		expect(screen.getByTestId("path-directories")).toHaveTextContent("/path/to")
		expect(screen.getByTestId("path-file")).toHaveTextContent("/file-name.ext")
	})

	it("shrinks all parent directories before shrinking the complete file name", () => {
		render(<MiddleTruncatedPath path="/path/to/file-name.ext" />)

		const directories = screen.getByTestId("path-directories")
		const file = screen.getByTestId("path-file")

		expect(directories).toHaveClass("shrink", "min-w-0", "text-ellipsis")
		expect(directories).not.toHaveClass("flex-1", "grow")
		expect(file).toHaveClass("shrink-0", "max-w-full")
		expect(file).toHaveTextContent("/file-name.ext")
	})

	it("only truncates the front of the file name when the complete file name exceeds the full row", () => {
		render(<MiddleTruncatedPath path="/path/to/very-long-file.ext" />)

		const fileStart = screen.getByTestId("path-file-start")
		const fileEnd = screen.getByTestId("path-file-end")

		expect(fileStart).toHaveTextContent("very-long-f")
		expect(fileStart).toHaveClass("min-w-[1ch]", "text-ellipsis")
		expect(fileEnd).toHaveTextContent("ile.ext")
		expect(fileEnd).toHaveClass("shrink-0")
	})

	it("preserves Windows separators and prioritizes the complete file name", () => {
		render(<MiddleTruncatedPath path={"C:\\workspace\\components\\Button.test.tsx"} />)

		expect(screen.getByTestId("path-directories").textContent).toBe("C:\\workspace\\components")
		expect(screen.getByTestId("path-file").textContent).toBe("\\Button.test.tsx")
	})

	it("supports a single path segment without adding a separator", () => {
		render(<MiddleTruncatedPath path="README.md" />)

		expect(screen.queryByTestId("path-directories")).not.toBeInTheDocument()
		expect(screen.getByTestId("path-file")).toHaveTextContent("README.md")
	})

	it("keeps relative path markers and additional content in the full tooltip", async () => {
		const user = userEvent.setup()
		render(<MiddleTruncatedPath path="../src/index.ts" additionalContent="const value = 1" />)

		expect(screen.getByTestId("path-display")).toHaveTextContent("../src/index.ts")
		expect(screen.getByText("const value = 1")).toHaveClass("text-ellipsis")

		await user.hover(screen.getByTestId("path-directories"))
		await waitFor(() => {
			expect(screen.getAllByText("../src/index.ts const value = 1").length).toBeGreaterThan(0)
		})
	})
})
