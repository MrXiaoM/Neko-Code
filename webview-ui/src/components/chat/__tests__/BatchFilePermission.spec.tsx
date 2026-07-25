import { render, screen, fireEvent } from "@/utils/test-utils"

import { TranslationProvider } from "@/i18n/__mocks__/TranslationContext"

import { BatchFilePermission } from "../BatchFilePermission"

const mockVscodePostMessage = vi.fn()

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: (...args: any[]) => mockVscodePostMessage(...args),
	},
}))

describe("BatchFilePermission", () => {
	const mockOnPermissionResponse = vi.fn()

	const mockFiles = [
		{
			key: "file1",
			path: "src/components/Button.tsx",
			content: "src/components/Button.tsx",
			lineSnippet: "export const Button = () => {",
			isOutsideWorkspace: false,
		},
		{
			key: "file2",
			path: "../outside/config.json",
			content: "/absolute/path/to/outside/config.json",
			lineSnippet: '{ "apiKey": "..." }',
			isOutsideWorkspace: true,
		},
		{
			key: "file3",
			path: "tests/Button.test.tsx",
			content: "tests/Button.test.tsx",
			lineSnippet: "describe('Button', () => {",
			isOutsideWorkspace: false,
		},
	]

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders file list correctly", () => {
		render(
			<TranslationProvider>
				<BatchFilePermission
					files={mockFiles}
					onPermissionResponse={mockOnPermissionResponse}
					ts={Date.now()}
				/>
			</TranslationProvider>,
		)

		// File names remain identifiable in the non-shrinking path suffix.
		const suffixes = screen.getAllByTestId("path-suffix")
		expect(suffixes[0]).toHaveTextContent("/Button.tsx")
		expect(suffixes[1]).toHaveTextContent("/config.json")
		expect(suffixes[2]).toHaveTextContent("/Button.test.tsx")

		// Check that line snippets are shown
		expect(screen.getByText(/export const Button = \(\) => \{/)).toBeInTheDocument()
		expect(screen.getByText(/\{ "apiKey": "\.\.\." \}/)).toBeInTheDocument()
		expect(screen.getByText(/describe\('Button', \(\) => \{/)).toBeInTheDocument()
	})

	it("renders nothing when files array is empty", () => {
		const { container } = render(
			<TranslationProvider>
				<BatchFilePermission files={[]} onPermissionResponse={mockOnPermissionResponse} ts={Date.now()} />
			</TranslationProvider>,
		)

		expect(container.firstChild).toBeNull()
	})

	it("renders nothing when onPermissionResponse is not provided", () => {
		const { container } = render(
			<TranslationProvider>
				<BatchFilePermission files={mockFiles} onPermissionResponse={undefined} ts={Date.now()} />
			</TranslationProvider>,
		)

		expect(container.firstChild).toBeNull()
	})

	it("opens file when clicking on file item", () => {
		render(
			<TranslationProvider>
				<BatchFilePermission
					files={mockFiles}
					onPermissionResponse={mockOnPermissionResponse}
					ts={Date.now()}
				/>
			</TranslationProvider>,
		)

		const filePathElement = screen.getAllByTestId("path-suffix")[0]
		const headerElement = filePathElement.closest(".flex.items-center.select-none")

		if (headerElement) {
			fireEvent.click(headerElement)
		}

		expect(mockVscodePostMessage).toHaveBeenCalledWith({
			type: "openFile",
			text: "src/components/Button.tsx",
		})
	})

	it("handles files with paths starting with dot correctly", () => {
		const filesWithDotPath = [
			{
				key: "file1",
				path: "./src/index.ts",
				content: "./src/index.ts",
				lineSnippet: "import React from 'react'",
			},
		]

		render(
			<TranslationProvider>
				<BatchFilePermission
					files={filesWithDotPath}
					onPermissionResponse={mockOnPermissionResponse}
					ts={Date.now()}
				/>
			</TranslationProvider>,
		)

		expect(screen.getByTestId("path-prefix")).toHaveTextContent("./src")
		expect(screen.getByTestId("path-suffix")).toHaveTextContent("/index.ts")
	})

	it("re-renders when timestamp changes", () => {
		const { rerender } = render(
			<TranslationProvider>
				<BatchFilePermission files={mockFiles} onPermissionResponse={mockOnPermissionResponse} ts={1000} />
			</TranslationProvider>,
		)

		// Initial render
		expect(screen.getAllByTestId("path-suffix")[0]).toHaveTextContent("/Button.tsx")

		// Re-render with new timestamp
		rerender(
			<TranslationProvider>
				<BatchFilePermission files={mockFiles} onPermissionResponse={mockOnPermissionResponse} ts={2000} />
			</TranslationProvider>,
		)

		// Should still show files
		expect(screen.getAllByTestId("path-suffix")[0]).toHaveTextContent("/Button.tsx")
	})

	it("displays external link icon for all files", () => {
		render(
			<TranslationProvider>
				<BatchFilePermission
					files={mockFiles}
					onPermissionResponse={mockOnPermissionResponse}
					ts={Date.now()}
				/>
			</TranslationProvider>,
		)

		// All files should have external link icons
		const externalLinkIcons = screen.getAllByText((_content, element) => {
			return element?.classList?.contains("codicon-link-external") ?? false
		})
		expect(externalLinkIcons).toHaveLength(mockFiles.length)
	})
})
