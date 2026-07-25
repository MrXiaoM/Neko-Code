import { render, screen } from "@/utils/test-utils"

import { TranslationProvider } from "@/i18n/__mocks__/TranslationContext"

import { BatchListFilesPermission } from "../BatchListFilesPermission"

describe("BatchListFilesPermission", () => {
	const mockDirs = [
		{
			key: "apps/cli",
			path: "apps/cli",
		},
		{
			key: "apps/vscode-e2e",
			path: "apps/vscode-e2e",
		},
		{
			key: "packages/core",
			path: "packages/core",
		},
	]

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders directory list correctly", () => {
		render(
			<TranslationProvider>
				<BatchListFilesPermission dirs={mockDirs} ts={Date.now()} />
			</TranslationProvider>,
		)

		const suffixes = screen.getAllByTestId("path-suffix")
		expect(suffixes[0]).toHaveTextContent("/cli")
		expect(suffixes[1]).toHaveTextContent("/vscode-e2e")
		expect(suffixes[2]).toHaveTextContent("/core")
	})

	it("renders nothing when dirs array is empty", () => {
		const { container } = render(
			<TranslationProvider>
				<BatchListFilesPermission dirs={[]} ts={Date.now()} />
			</TranslationProvider>,
		)

		expect(container.firstChild).toBeNull()
	})

	it("re-renders when timestamp changes", () => {
		const { rerender } = render(
			<TranslationProvider>
				<BatchListFilesPermission dirs={mockDirs} ts={1000} />
			</TranslationProvider>,
		)

		expect(screen.getAllByTestId("path-suffix")[0]).toHaveTextContent("/cli")

		rerender(
			<TranslationProvider>
				<BatchListFilesPermission dirs={mockDirs} ts={2000} />
			</TranslationProvider>,
		)

		expect(screen.getAllByTestId("path-suffix")[0]).toHaveTextContent("/cli")
	})

	it("renders all directories in a single container", () => {
		render(
			<TranslationProvider>
				<BatchListFilesPermission dirs={mockDirs} ts={Date.now()} />
			</TranslationProvider>,
		)

		// All directories should be within a single bordered container
		const container = screen.getAllByTestId("path-suffix")[0].closest(".border.border-border.rounded-md")
		expect(container).toBeInTheDocument()

		// All 3 dirs should be inside this container
		expect(container?.querySelectorAll(".flex.items-center.gap-2")).toHaveLength(mockDirs.length)
	})

	it("renders a single directory", () => {
		const singleDir = [
			{
				key: "apps/cli",
				path: "apps/cli",
			},
		]

		render(
			<TranslationProvider>
				<BatchListFilesPermission dirs={singleDir} ts={Date.now()} />
			</TranslationProvider>,
		)

		expect(screen.getByTestId("path-suffix")).toHaveTextContent("/cli")

		// Single directory should still be rendered inside the container
		const bordered = screen.getByTestId("path-suffix").closest(".border.border-border.rounded-md")
		expect(bordered).toBeInTheDocument()
		expect(bordered?.querySelectorAll(".flex.items-center.gap-2")).toHaveLength(1)
	})
})
