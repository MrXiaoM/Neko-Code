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
	let animationFrameCallbacks: FrameRequestCallback[]

	beforeEach(() => {
		animationFrameCallbacks = []
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			animationFrameCallbacks.push(callback)
			return animationFrameCallbacks.length
		})
		vi.stubGlobal("cancelAnimationFrame", vi.fn())
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("uses the supplied maximum height", () => {
		render(
			<CommandList maxHeight="min(520px, calc(100vh - 220px))" data-testid="command-list">
				Option
			</CommandList>,
		)

		expect(screen.getByTestId("command-list")).toHaveStyle({ maxHeight: "min(520px, calc(100vh - 220px))" })
	})

	it("caps large wheel input and scrolls toward the target over animation frames", () => {
		render(
			<CommandList smoothWheel data-testid="command-list">
				Option
			</CommandList>,
		)

		const list = screen.getByTestId("command-list")
		Object.defineProperties(list, {
			clientHeight: { configurable: true, value: 100 },
			scrollHeight: { configurable: true, value: 1_000 },
		})

		fireEvent.wheel(list, { deltaY: 1_000 })

		expect(list.scrollTop).toBe(0)
		expect(animationFrameCallbacks).toHaveLength(1)

		animationFrameCallbacks.shift()?.(0)

		expect(list.scrollTop).toBeCloseTo(28)
		expect(list.scrollTop).toBeLessThan(80)
	})

	it("lets the outer page scroll when the list is already at its lower boundary", () => {
		render(
			<CommandList smoothWheel data-testid="command-list">
				Option
			</CommandList>,
		)

		const list = screen.getByTestId("command-list")
		Object.defineProperties(list, {
			clientHeight: { configurable: true, value: 100 },
			scrollHeight: { configurable: true, value: 1_000 },
		})
		list.scrollTop = 900

		const wasHandled = fireEvent.wheel(list, { deltaY: 120 })

		expect(wasHandled).toBe(true)
		expect(animationFrameCallbacks).toHaveLength(0)
	})
})
