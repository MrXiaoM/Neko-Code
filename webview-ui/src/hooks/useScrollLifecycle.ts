/**
 * useScrollLifecycle
 *
 * Simplified chat scroll lifecycle with a short, time-boxed hydration window.
 *
 * - Task switch enters `HYDRATING_PINNED_TO_BOTTOM`
 * - We issue one immediate `scrollToIndex("LAST")` and one post-render retry
 * - During hydration, transient Virtuoso `atBottomStateChange(false)` signals
 *   are ignored so follow mode does not flicker off
 * - A user pointer drag moving the Virtuoso scroller upward, plus wheel /
 *   keyboard intent and row expansion, moves to `USER_BROWSING_HISTORY` synchronously.
 * - Once browsing history, only the explicit scroll-to-bottom action can
 *   re-enable following; content measurement must never steal scroll control.
 */

import React, { useCallback, useEffect, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useEvent } from "react-use"
import debounce from "debounce"
import type { VirtuosoHandle } from "react-virtuoso"

const HYDRATION_WINDOW_MS = 600
const HYDRATION_RETRY_WINDOW_MS = 160

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScrollPhase = "HYDRATING_PINNED_TO_BOTTOM" | "ANCHORED_FOLLOWING" | "USER_BROWSING_HISTORY"

export type ScrollFollowDisengageSource = "wheel-up" | "row-expansion" | "keyboard-nav-up" | "pointer-scroll-up"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isEditableKeyboardTarget = (target: EventTarget | null): boolean => {
	if (!(target instanceof HTMLElement)) {
		return false
	}
	if (target.isContentEditable) {
		return true
	}
	const tagName = target.tagName
	return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT"
}

// ---------------------------------------------------------------------------
// Hook interface
// ---------------------------------------------------------------------------

export interface UseScrollLifecycleOptions {
	virtuosoRef: React.RefObject<VirtuosoHandle | null>
	scrollContainerRef: React.RefObject<HTMLDivElement | null>
	taskTs: number | undefined
	contentChangeKey: string
	isStreaming: boolean
	isHidden: boolean
	hasTask: boolean
	bottomTolerance: number
}

export interface UseScrollLifecycleReturn {
	scrollPhase: ScrollPhase
	showScrollToBottom: boolean
	handleRowHeightChange: (isTaller: boolean) => void
	handleContentHeightChange: () => void
	handleScrollToBottomClick: () => void
	enterUserBrowsingHistory: (source: ScrollFollowDisengageSource) => void
	followOutputCallback: () => "auto" | false
	atBottomStateChangeCallback: (isAtBottom: boolean) => void
	scrollToBottomAuto: () => void
	isAtBottomRef: React.MutableRefObject<boolean>
	scrollPhaseRef: React.MutableRefObject<ScrollPhase>
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

export function useScrollLifecycle({
	virtuosoRef,
	scrollContainerRef,
	taskTs,
	contentChangeKey,
	isStreaming,
	isHidden,
	hasTask,
	bottomTolerance,
}: UseScrollLifecycleOptions): UseScrollLifecycleReturn {
	// --- Mounted guard ---
	const isMountedRef = useRef(true)

	// --- Phase state ---
	const [scrollPhase, setScrollPhase] = useState<ScrollPhase>("USER_BROWSING_HISTORY")
	const scrollPhaseRef = useRef<ScrollPhase>("USER_BROWSING_HISTORY")

	// --- Visibility state ---
	const [showScrollToBottom, setShowScrollToBottom] = useState(false)

	// --- Bottom detection ---
	const isAtBottomRef = useRef(false)

	// --- Hydration window ---
	const isHydratingRef = useRef(false)
	const hydrationTimeoutRef = useRef<number | null>(null)
	const hydrationRetryUsedRef = useRef(false)

	// --- Actual Virtuoso scroller tracking ---
	const lastScrollerTopRef = useRef<number | null>(null)
	const isPointerScrollingRef = useRef(false)

	// --- Re-anchor frame ---
	const reanchorAnimationFrameRef = useRef<number | null>(null)
	const previousContentChangeKeyRef = useRef<string | null>(null)
	const previousContentTaskTsRef = useRef<number | undefined>(undefined)
	const shouldReanchorAfterContentChangeRef = useRef(false)

	// -----------------------------------------------------------------------
	// Phase transitions
	// -----------------------------------------------------------------------

	const transitionScrollPhase = useCallback((nextPhase: ScrollPhase) => {
		if (scrollPhaseRef.current === nextPhase) {
			return
		}
		scrollPhaseRef.current = nextPhase
		setScrollPhase(nextPhase)
	}, [])

	const enterAnchoredFollowing = useCallback(() => {
		transitionScrollPhase("ANCHORED_FOLLOWING")
		setShowScrollToBottom(false)
	}, [transitionScrollPhase])

	const enterUserBrowsingHistory = useCallback(
		(_source: ScrollFollowDisengageSource) => {
			transitionScrollPhase("USER_BROWSING_HISTORY")
			// Always show the scroll-to-bottom CTA when the user explicitly
			// disengages. If they happen to still be at the physical bottom,
			// the next Virtuoso atBottomStateChange(true) will hide it.
			setShowScrollToBottom(true)
		},
		[transitionScrollPhase],
	)

	const cancelReanchorFrame = useCallback(() => {
		if (reanchorAnimationFrameRef.current !== null) {
			cancelAnimationFrame(reanchorAnimationFrameRef.current)
			reanchorAnimationFrameRef.current = null
		}
	}, [])

	// -----------------------------------------------------------------------
	// Scroll commands
	// -----------------------------------------------------------------------

	const scrollToBottomSmooth = useMemo(
		() =>
			debounce(
				() => virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "smooth" }),
				10,
				{ immediate: true },
			),
		[virtuosoRef],
	)

	const scrollToBottomAuto = useCallback(() => {
		virtuosoRef.current?.scrollToIndex({
			index: "LAST",
			align: "end",
			behavior: "auto",
		})
	}, [virtuosoRef])

	const clearHydrationWindow = useCallback(() => {
		isHydratingRef.current = false
		hydrationRetryUsedRef.current = false
		if (hydrationTimeoutRef.current !== null) {
			window.clearTimeout(hydrationTimeoutRef.current)
			hydrationTimeoutRef.current = null
		}
	}, [])

	const finishHydrationWindow = useCallback(() => {
		if (!isMountedRef.current || !isHydratingRef.current) {
			return
		}

		if (scrollPhaseRef.current === "HYDRATING_PINNED_TO_BOTTOM") {
			if (isAtBottomRef.current) {
				enterAnchoredFollowing()
			} else {
				if (!hydrationRetryUsedRef.current) {
					hydrationRetryUsedRef.current = true
					scrollToBottomAuto()
					hydrationTimeoutRef.current = window.setTimeout(() => {
						finishHydrationWindow()
					}, HYDRATION_RETRY_WINDOW_MS)
					return
				}

				// Retry budget exhausted. Keep anchored follow rather than
				// downgrading to browsing mode due to non-user transient drift.
				enterAnchoredFollowing()
			}
		}

		clearHydrationWindow()
	}, [clearHydrationWindow, enterAnchoredFollowing, scrollToBottomAuto])

	const startHydrationWindow = useCallback(() => {
		isHydratingRef.current = true
		hydrationRetryUsedRef.current = false
		if (hydrationTimeoutRef.current !== null) {
			window.clearTimeout(hydrationTimeoutRef.current)
		}
		hydrationTimeoutRef.current = window.setTimeout(() => {
			finishHydrationWindow()
		}, HYDRATION_WINDOW_MS)

		scrollToBottomAuto()
	}, [finishHydrationWindow, scrollToBottomAuto])

	// -----------------------------------------------------------------------
	// Lifecycle effects
	// -----------------------------------------------------------------------

	// Mounted guard + global cleanup
	useEffect(() => {
		isMountedRef.current = true
		return () => {
			isMountedRef.current = false
			clearHydrationWindow()
			cancelReanchorFrame()
			scrollToBottomSmooth.clear()
		}
	}, [cancelReanchorFrame, clearHydrationWindow, scrollToBottomSmooth])

	// Keep phase ref in sync with state
	useEffect(() => {
		scrollPhaseRef.current = scrollPhase
	}, [scrollPhase])

	// Task switch: reset and begin a short hydration window
	useEffect(() => {
		isAtBottomRef.current = false
		lastScrollerTopRef.current = null
		isPointerScrollingRef.current = false
		clearHydrationWindow()
		cancelReanchorFrame()

		if (taskTs) {
			transitionScrollPhase("HYDRATING_PINNED_TO_BOTTOM")
			setShowScrollToBottom(false)
			startHydrationWindow()
		} else {
			transitionScrollPhase("USER_BROWSING_HISTORY")
			setShowScrollToBottom(false)
		}

		return () => {
			clearHydrationWindow()
			cancelReanchorFrame()
		}
	}, [cancelReanchorFrame, clearHydrationWindow, startHydrationWindow, taskTs, transitionScrollPhase])

	// -----------------------------------------------------------------------
	// Content and layout changes
	// -----------------------------------------------------------------------

	const canFollowContentChanges = useCallback(() => {
		return scrollPhaseRef.current === "ANCHORED_FOLLOWING"
	}, [])

	// A list update is already committed by the time Virtuoso emits its next
	// atBottomStateChange(false). Capture the physical bottom position from an
	// insertion-effect cleanup, which React runs before it mutates the DOM for
	// the next commit, then restore it from the next layout effect.
	useInsertionEffect(() => {
		const scrollContainer = scrollContainerRef.current
		return () => {
			const scroller = scrollContainer?.querySelector<HTMLElement>(".scrollable")
			const distanceFromBottom = scroller
				? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
				: Number.POSITIVE_INFINITY
			shouldReanchorAfterContentChangeRef.current =
				canFollowContentChanges() && (isAtBottomRef.current || distanceFromBottom <= bottomTolerance)
		}
	}, [bottomTolerance, canFollowContentChanges, contentChangeKey, scrollContainerRef, taskTs])

	useLayoutEffect(() => {
		const isTaskChange = previousContentTaskTsRef.current !== taskTs
		const previousContentChangeKey = previousContentChangeKeyRef.current
		previousContentTaskTsRef.current = taskTs
		previousContentChangeKeyRef.current = contentChangeKey

		if (
			!isTaskChange &&
			previousContentChangeKey !== null &&
			previousContentChangeKey !== contentChangeKey &&
			shouldReanchorAfterContentChangeRef.current &&
			canFollowContentChanges()
		) {
			scrollToBottomAuto()
		}
	}, [canFollowContentChanges, contentChangeKey, scrollToBottomAuto, taskTs])

	const handleRowHeightChange = useCallback(
		(isTaller: boolean) => {
			if (!canFollowContentChanges()) {
				return
			}

			if (isTaller) {
				scrollToBottomSmooth()
			} else {
				scrollToBottomAuto()
			}
		},
		[canFollowContentChanges, scrollToBottomSmooth, scrollToBottomAuto],
	)

	const handleContentHeightChange = useCallback(() => {
		if (canFollowContentChanges()) {
			scrollToBottomAuto()
		}
	}, [canFollowContentChanges, scrollToBottomAuto])

	// -----------------------------------------------------------------------
	// Scroll-to-bottom click handler
	// -----------------------------------------------------------------------

	const handleScrollToBottomClick = useCallback(() => {
		enterAnchoredFollowing()
		scrollToBottomAuto()
		cancelReanchorFrame()
		reanchorAnimationFrameRef.current = requestAnimationFrame(() => {
			reanchorAnimationFrameRef.current = null
			if (scrollPhaseRef.current === "ANCHORED_FOLLOWING") {
				scrollToBottomAuto()
			}
		})
	}, [cancelReanchorFrame, enterAnchoredFollowing, scrollToBottomAuto])

	// -----------------------------------------------------------------------
	// Virtuoso callback: followOutput
	// -----------------------------------------------------------------------

	const followOutputCallback = useCallback((): "auto" | false => {
		// Virtuoso can request this callback before React commits the state update
		// caused by an upward user scroll. The ref changes synchronously and closes
		// that window before a streaming update can pull the viewport back down.
		return scrollPhaseRef.current === "USER_BROWSING_HISTORY" ? false : "auto"
	}, [])

	// -----------------------------------------------------------------------
	// Virtuoso callback: atBottomStateChange
	// -----------------------------------------------------------------------

	const atBottomStateChangeCallback = useCallback(
		(isAtBottom: boolean) => {
			isAtBottomRef.current = isAtBottom

			const currentPhase = scrollPhaseRef.current

			if (isAtBottom) {
				const scroller = scrollContainerRef.current?.querySelector<HTMLElement>(".scrollable")
				lastScrollerTopRef.current = scroller?.scrollTop ?? null
				// The CTA represents a physical destination, not whether automatic
				// following is enabled. Once Virtuoso reports that destination reached,
				// it must disappear even if the user remains in history-browsing mode.
				setShowScrollToBottom(false)
			}

			if (!isAtBottom && isHydratingRef.current && currentPhase !== "USER_BROWSING_HISTORY") {
				setShowScrollToBottom(false)
				return
			}

			if (currentPhase === "USER_BROWSING_HISTORY") {
				// Being within Virtuoso's bottom threshold is not user intent to resume
				// following. In particular, a small upward movement can still report true.
				// But an actual bottom report always hides the CTA above.
				if (!isAtBottom) {
					setShowScrollToBottom(true)
				}
				return
			}

			if (isAtBottom) {
				enterAnchoredFollowing()
				return
			}

			if (currentPhase === "ANCHORED_FOLLOWING" && isStreaming) {
				scrollToBottomAuto()
				setShowScrollToBottom(false)
				return
			}

			setShowScrollToBottom(false)
		},
		[enterAnchoredFollowing, isStreaming, scrollContainerRef, scrollToBottomAuto],
	)

	// -----------------------------------------------------------------------
	// User intent: wheel
	// -----------------------------------------------------------------------

	const handleWheel = useCallback(
		(event: Event) => {
			const wheelEvent = event as WheelEvent
			if (wheelEvent.deltaY < 0 && scrollContainerRef.current?.contains(wheelEvent.target as Node)) {
				enterUserBrowsingHistory("wheel-up")
			}
		},
		[enterUserBrowsingHistory, scrollContainerRef],
	)
	useEvent("wheel", handleWheel, window, { passive: true })

	// -----------------------------------------------------------------------
	// Actual scroller movement
	// -----------------------------------------------------------------------

	const captureScrollerBaseline = useCallback(
		(event: Event) => {
			const pointerTarget = event.target
			if (!(pointerTarget instanceof HTMLElement) || !scrollContainerRef.current?.contains(pointerTarget)) {
				return
			}

			const scroller = pointerTarget.closest<HTMLElement>(".scrollable")
			if (scroller) {
				isPointerScrollingRef.current = false
				lastScrollerTopRef.current = scroller.scrollTop
			}
		},
		[scrollContainerRef],
	)

	const markPointerScrolling = useCallback(
		(event: Event) => {
			const pointerTarget = event.target
			if (!(pointerTarget instanceof HTMLElement) || !scrollContainerRef.current?.contains(pointerTarget)) {
				return
			}

			if (pointerTarget.closest<HTMLElement>(".scrollable")) {
				isPointerScrollingRef.current = true
			}
		},
		[scrollContainerRef],
	)

	const clearPointerScrolling = useCallback(() => {
		isPointerScrollingRef.current = false
	}, [])

	const handleScrollerScroll = useCallback(
		(event: Event) => {
			const scrollTarget = event.target
			if (!(scrollTarget instanceof HTMLElement) || !scrollContainerRef.current?.contains(scrollTarget)) {
				return
			}

			// Only observe Virtuoso's outer scroller. Nested code blocks and other
			// inner scrollables must not disable chat follow mode.
			const scroller = scrollTarget.closest(".scrollable")
			if (scroller !== scrollTarget) {
				return
			}

			const previousTop = lastScrollerTopRef.current
			const currentTop = scrollTarget.scrollTop
			lastScrollerTopRef.current = currentTop

			const distanceFromBottom = scrollTarget.scrollHeight - scrollTarget.clientHeight - currentTop
			if (
				isPointerScrollingRef.current &&
				previousTop !== null &&
				currentTop < previousTop &&
				distanceFromBottom > bottomTolerance
			) {
				enterUserBrowsingHistory("pointer-scroll-up")
			}
		},
		[bottomTolerance, enterUserBrowsingHistory, scrollContainerRef],
	)

	useEvent("pointerdown", captureScrollerBaseline, window, { passive: true })
	useEvent("pointermove", markPointerScrolling, window, { passive: true })
	useEvent("pointerup", clearPointerScrolling, window, { passive: true })
	useEvent("pointercancel", clearPointerScrolling, window, { passive: true })
	useEvent("scroll", handleScrollerScroll, window, { passive: true, capture: true })

	// -----------------------------------------------------------------------
	// User intent: keyboard navigation
	// -----------------------------------------------------------------------

	const handleScrollKeyDown = useCallback(
		(event: Event) => {
			const keyEvent = event as KeyboardEvent

			if (!hasTask || isHidden) {
				return
			}

			if (keyEvent.metaKey || keyEvent.ctrlKey || keyEvent.altKey) {
				return
			}

			if (keyEvent.key !== "PageUp" && keyEvent.key !== "Home" && keyEvent.key !== "ArrowUp") {
				return
			}

			if (isEditableKeyboardTarget(keyEvent.target)) {
				return
			}

			const activeElement = document.activeElement
			const focusInsideChat =
				activeElement instanceof HTMLElement && !!scrollContainerRef.current?.contains(activeElement)
			const eventTargetInsideChat =
				keyEvent.target instanceof Node && !!scrollContainerRef.current?.contains(keyEvent.target)

			if (focusInsideChat || eventTargetInsideChat || activeElement === document.body) {
				enterUserBrowsingHistory("keyboard-nav-up")
			}
		},
		[enterUserBrowsingHistory, hasTask, isHidden, scrollContainerRef],
	)
	useEvent("keydown", handleScrollKeyDown, window)

	// -----------------------------------------------------------------------
	// Return public API
	// -----------------------------------------------------------------------

	return {
		scrollPhase,
		showScrollToBottom,
		handleRowHeightChange,
		handleContentHeightChange,
		handleScrollToBottomClick,
		enterUserBrowsingHistory,
		followOutputCallback,
		atBottomStateChangeCallback,
		scrollToBottomAuto,
		isAtBottomRef,
		scrollPhaseRef,
	}
}
