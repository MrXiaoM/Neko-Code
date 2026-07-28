// npx vitest run src/components/ui/__tests__/command.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"

import { CommandList } from "../command"

vi.mock("cmdk", () => ({
	Command: {
		List: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
		Empty: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
		Group: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
		Separator: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
		Item: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
		Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
	},
}))

describe("CommandList", () => {
	it("uses the supplied maximum height", () => {
		render(
			<CommandList maxHeight="min(520px, calc(100vh - 220px))" data-testid="command-list">
				Option
			</CommandList>,
		)

		expect(screen.getByTestId("command-list")).toHaveStyle({ maxHeight: "min(520px, calc(100vh - 220px))" })
	})

	it("uses native wheel handling without manually updating the scroll position", () => {
		render(
			<CommandList nativeWheel data-testid="command-list">
				Option
			</CommandList>,
		)

		const list = screen.getByTestId("command-list")
		list.scrollTop = 20

		const wasHandled = fireEvent.wheel(list, { deltaY: 1_000 })

		expect(wasHandled).toBe(true)
		expect(list.scrollTop).toBe(20)
	})

	it("keeps the WebView scroll workaround as the default behavior", () => {
		render(<CommandList data-testid="command-list">Option</CommandList>)

		const list = screen.getByTestId("command-list")
		fireEvent.wheel(list, { deltaY: 120 })

		expect(list.scrollTop).toBe(120)
	})
})
