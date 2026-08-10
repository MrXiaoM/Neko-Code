import { act, renderHook } from "@testing-library/react"
import type { VirtuosoHandle } from "react-virtuoso"

import { useScrollLifecycle } from "../useScrollLifecycle"

const createScroller = () => {
	const container = document.createElement("div")
	const scroller = document.createElement("div")
	scroller.className = "scrollable"
	Object.defineProperties(scroller, {
		clientHeight: { configurable: true, value: 100 },
		scrollHeight: { configurable: true, value: 500 },
	})
	scroller.scrollTop = 400
	container.appendChild(scroller)
	document.body.appendChild(container)
	return { container, scroller }
}

describe("useScrollLifecycle", () => {
	let container: HTMLDivElement
	let scrollToIndex: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.useFakeTimers()
		const scroller = createScroller()
		container = scroller.container
		scrollToIndex = vi.fn()
	})

	afterEach(() => {
		container.remove()
		vi.clearAllTimers()
		vi.useRealTimers()
	})

	const renderScrollLifecycle = (contentChangeKey = "first") => {
		const virtuosoRef = { current: { scrollToIndex } as unknown as VirtuosoHandle }
		const scrollContainerRef = { current: container }

		return renderHook(
			({ key }) =>
				useScrollLifecycle({
					virtuosoRef,
					scrollContainerRef,
					taskTs: 1,
					contentChangeKey: key,
					isStreaming: true,
					isHidden: false,
					hasTask: true,
					bottomTolerance: 40,
				}),
			{ initialProps: { key: contentChangeKey } },
		)
	}

	it("reanchors after content changes that begin while the viewport is at the bottom", () => {
		const { result, rerender } = renderScrollLifecycle()

		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		scrollToIndex.mockClear()

		act(() => {
			rerender({ key: "second" })
		})

		expect(scrollToIndex).toHaveBeenCalledWith({ index: "LAST", align: "end", behavior: "auto" })
	})

	it("keeps layout-height follow disabled after the user starts browsing history", () => {
		const { result } = renderScrollLifecycle()

		act(() => {
			result.current.atBottomStateChangeCallback(true)
		})
		scrollToIndex.mockClear()

		act(() => {
			result.current.handleContentHeightChange()
		})
		expect(scrollToIndex).toHaveBeenCalledWith({ index: "LAST", align: "end", behavior: "auto" })

		scrollToIndex.mockClear()
		act(() => {
			result.current.enterUserBrowsingHistory("wheel-up")
			result.current.handleContentHeightChange()
		})

		expect(scrollToIndex).not.toHaveBeenCalled()
	})
})
