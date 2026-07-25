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

		const paths = screen.getAllByTestId("path-display")
		expect(paths[0]).toHaveTextContent("apps/cli")
		expect(paths[1]).toHaveTextContent("apps/vscode-e2e")
		expect(paths[2]).toHaveTextContent("packages/core")
		for (const pathDisplay of paths) {
			const competingSibling = Array.from(pathDisplay.parentElement?.children ?? []).find(
				(element) =>
					element !== pathDisplay &&
					["flex-1", "flex-grow", "flex-grow-1"].some((className) => element.classList.contains(className)),
			)
			expect(competingSibling).toBeUndefined()
		}
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

		expect(screen.getAllByTestId("path-display")[0]).toHaveTextContent("apps/cli")

		rerender(
			<TranslationProvider>
				<BatchListFilesPermission dirs={mockDirs} ts={2000} />
			</TranslationProvider>,
		)

		expect(screen.getAllByTestId("path-display")[0]).toHaveTextContent("apps/cli")
	})

	it("renders all directories in a single container", () => {
		render(
			<TranslationProvider>
				<BatchListFilesPermission dirs={mockDirs} ts={Date.now()} />
			</TranslationProvider>,
		)

		// All directories should be within a single bordered container
		const container = screen.getAllByTestId("path-display")[0].closest(".border.border-border.rounded-md")
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

		expect(screen.getByTestId("path-display")).toHaveTextContent("apps/cli")

		// Single directory should still be rendered inside the container
		const bordered = screen.getByTestId("path-display").closest(".border.border-border.rounded-md")
		expect(bordered).toBeInTheDocument()
		expect(bordered?.querySelectorAll(".flex.items-center.gap-2")).toHaveLength(1)
	})
})
