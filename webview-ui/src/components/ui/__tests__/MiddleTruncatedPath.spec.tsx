import { render, screen, waitFor } from "@/utils/test-utils"
import userEvent from "@testing-library/user-event"

import { MiddleTruncatedPath } from "../MiddleTruncatedPath"

describe("MiddleTruncatedPath", () => {
	it("splits a POSIX path into a truncatable prefix and recognizable file name tail", () => {
		render(<MiddleTruncatedPath path="/path/to/very-long-file.ext" />)

		expect(screen.getByTestId("path-prefix")).toHaveTextContent("/path/to")
		expect(screen.getByTestId("path-prefix")).toHaveClass("text-ellipsis")
		expect(screen.getByTestId("path-suffix")).toHaveTextContent("/very-long-file.ext")
		expect(screen.getByTestId("path-name-start")).toHaveClass("text-ellipsis")
		expect(screen.getByTestId("path-name-end")).toHaveTextContent("ile.ext")
		expect(screen.getByTestId("path-name-end")).toHaveClass("shrink-0")
	})

	it("preserves Windows separators and the file extension tail", () => {
		render(<MiddleTruncatedPath path={"C:\\workspace\\components\\Button.test.tsx"} />)

		expect(screen.getByTestId("path-prefix").textContent).toBe("C:\\workspace\\components")
		expect(screen.getByTestId("path-suffix").textContent).toBe("\\Button.test.tsx")
		expect(screen.getByTestId("path-name-end")).toHaveTextContent("est.tsx")
	})

	it("supports a single path segment without adding a separator", () => {
		render(<MiddleTruncatedPath path="README.md" />)

		expect(screen.queryByTestId("path-prefix")).not.toBeInTheDocument()
		expect(screen.getByTestId("path-suffix")).toHaveTextContent("README.md")
		expect(screen.getByTestId("path-name-end")).toHaveTextContent("DME.md")
	})

	it("keeps relative path markers and additional content in the full tooltip", async () => {
		const user = userEvent.setup()
		render(<MiddleTruncatedPath path="../src/index.ts" additionalContent="const value = 1" />)

		expect(screen.getByTestId("path-prefix")).toHaveTextContent("../src")
		expect(screen.getByTestId("path-suffix")).toHaveTextContent("/index.ts")
		expect(screen.getByText("const value = 1")).toHaveClass("text-ellipsis")

		await user.hover(screen.getByTestId("path-prefix"))
		await waitFor(() => {
			expect(screen.getAllByText("../src/index.ts const value = 1").length).toBeGreaterThan(0)
		})
	})
})
