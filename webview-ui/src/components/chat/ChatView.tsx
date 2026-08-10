import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { useDeepCompareEffect, useEvent } from "react-use"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import removeMd from "remove-markdown"
import useSound from "use-sound"
import { LRUCache } from "lru-cache"

import { useDebounceEffect } from "@src/utils/useDebounceEffect"
import { appendImages } from "@src/utils/imageUtils"
import { getCostBreakdownIfNeeded } from "@src/utils/costFormatting"
import { replaceTextAreaValue } from "@src/utils/nativeTextArea"
import { batchNearby } from "@src/utils/batchNearby"
import { isBoundary, isIgnorableBetweenTargets } from "@src/utils/chatBatchingPredicates"

import type { ClineAsk, ClineSayTool, ClineMessage, ExtensionMessage, AudioType, SuggestionItem } from "@roo-code/types"
import { getCompletionCheckpoint, getSuggestionMode, isRetiredProvider } from "@roo-code/types"

import { findLast } from "@roo/array"
import { combineApiRequests } from "@roo/combineApiRequests"
import { combineCommandSequences } from "@roo/combineCommandSequences"
import { getApiMetrics } from "@roo/getApiMetrics"
import { getAllModes } from "@roo/modes"
import { ProfileValidator } from "@roo/ProfileValidator"
import { getLatestTodo } from "@roo/todo"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"
import RooHero from "@src/components/welcome/RooHero"
import RooTips from "@src/components/welcome/RooTips"
import { StandardTooltip, Button } from "@src/components/ui"

import TelemetryBanner from "../common/TelemetryBanner"
import VersionIndicator from "../common/VersionIndicator"
import HistoryPreview from "../history/HistoryPreview"
import Announcement from "./Announcement"
import ChatRow from "./ChatRow"
import WarningRow from "./WarningRow"
import { ChatTextArea } from "./ChatTextArea"
import TaskHeader from "./TaskHeader"
import ProfileViolationWarning from "./ProfileViolationWarning"
import { CheckpointWarning } from "./CheckpointWarning"
import { QueuedMessages } from "./QueuedMessages"
import { WorktreeSelector } from "./WorktreeSelector"
import FileChangesPanel from "./FileChangesPanel"
import { fileChangesFromMessages } from "./utils/fileChangesFromMessages"
import { useScrollLifecycle } from "@src/hooks/useScrollLifecycle"

export interface ChatViewProps {
	isHidden: boolean
	showAnnouncement: boolean
	hideAnnouncement: () => void
}

export interface ChatViewRef {
	acceptInput: () => void
}

export const MAX_IMAGES_PER_MESSAGE = 20 // This is the Anthropic limit.
const CHAT_DEFAULT_ITEM_HEIGHT = 180
const BOTTOM_OVERLAY_ROW_HEIGHT = 40
const BOTTOM_SCROLL_TOLERANCE = BOTTOM_OVERLAY_ROW_HEIGHT
const CHAT_VIEWPORT_BUFFER = {
	top: 600,
	bottom: 800,
} as const

const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0

const ChatViewComponent: React.ForwardRefRenderFunction<ChatViewRef, ChatViewProps> = (
	{ isHidden, showAnnouncement, hideAnnouncement },
	ref,
) => {
	const [audioBaseUri] = useState(() => {
		return (window as unknown as { AUDIO_BASE_URI?: string }).AUDIO_BASE_URI || ""
	})

	const [imagesBaseUri] = useState(() => {
		return (window as unknown as { IMAGES_BASE_URI?: string }).IMAGES_BASE_URI || ""
	})

	const { t } = useAppTranslation()
	const modeShortcutText = `${isMac ? "⌘" : "Ctrl"} + . ${t("chat:forNextMode")}, ${isMac ? "⌘" : "Ctrl"} + Shift + . ${t("chat:forPreviousMode")}`

	const {
		clineMessages: messages,
		currentTaskItem,
		currentTaskTodos,
		taskHistory,
		apiConfiguration,
		organizationAllowList,
		mode,
		setMode,
		alwaysAllowModeSwitch,
		customModes,
		soundEnabled,
		soundVolume,
		messageQueue = [],
		showWorktreesInHomeScreen,
		telemetrySetting,
		backgroundImageEnabled = true,
		backgroundImageUrl = null,
		backgroundImageSize = "contain",
		backgroundImagePosition = "right",
		backgroundImageOffset = 0,
		backgroundImageOpacity = 0.25,
		renderContext,
		dedicatedIdeLayoutEnabled = false,
	} = useExtensionState()
	const isComposerOnly = renderContext === "composer"
	const isDedicatedConversation = renderContext === "editor" && dedicatedIdeLayoutEnabled
	const isInactiveComposer = isComposerOnly && !dedicatedIdeLayoutEnabled

	// Compute background image style
	const backgroundImageStyle = useMemo(() => {
		if (isComposerOnly || !backgroundImageEnabled) {
			return { display: "none" }
		}

		const bgUrl = backgroundImageUrl || `${imagesBaseUri}/bg-default.png`

		const sizeMap: Record<string, string> = {
			contain: "auto 100%",
			cover: "cover",
			auto: "auto",
		}

		const anchorMap: Record<string, string> = {
			left: "0%",
			center: "50%",
			right: "100%",
		}

		return {
			position: "absolute" as const,
			inset: 0,
			zIndex: 0,
			pointerEvents: "none" as const,
			backgroundImage: `url(${bgUrl})`,
			backgroundRepeat: "no-repeat" as const,
			backgroundSize: sizeMap[backgroundImageSize] || "auto 100%",
			backgroundPosition: `calc(${anchorMap[backgroundImagePosition] || "100%"} + ${backgroundImageOffset} * 1%) center`,
			opacity: backgroundImageOpacity,
		}
	}, [
		isComposerOnly,
		backgroundImageEnabled,
		backgroundImageUrl,
		backgroundImageSize,
		backgroundImagePosition,
		backgroundImageOffset,
		backgroundImageOpacity,
		imagesBaseUri,
	])

	// Show a WarningRow when the user sends a message with a retired provider.
	const [showRetiredProviderWarning, setShowRetiredProviderWarning] = useState(false)

	// When the provider changes, clear the retired-provider warning.
	const providerName = apiConfiguration?.apiProvider
	useEffect(() => {
		setShowRetiredProviderWarning(false)
	}, [providerName])

	const messagesRef = useRef(messages)

	useEffect(() => {
		messagesRef.current = messages
	}, [messages])

	// Leaving this less safe version here since if the first message is not a
	// task, then the extension is in a bad state and needs to be debugged (see
	// Cline.abort).
	const task = useMemo(() => messages.at(0), [messages])

	const latestTodos = useMemo(() => {
		// First check if we have initial todos from the state (for new subtasks)
		if (currentTaskTodos && currentTaskTodos.length > 0) {
			// Check if there are any todo updates in messages
			const messageBasedTodos = getLatestTodo(messages)
			// If there are message-based todos, they take precedence (user has updated them)
			if (messageBasedTodos && messageBasedTodos.length > 0) {
				return messageBasedTodos
			}
			// Otherwise use the initial todos from state
			return currentTaskTodos
		}
		// Fall back to extracting from messages
		return getLatestTodo(messages)
	}, [messages, currentTaskTodos])

	const modifiedMessages = useMemo(() => combineApiRequests(combineCommandSequences(messages.slice(1))), [messages])
	const completionCheckpoint = useMemo(() => getCompletionCheckpoint(messages), [messages])
	const completionResultTs = useMemo(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i]

			if (message?.type === "say" && message.say === "completion_result") {
				return message.ts
			}

			// Zero-text ask completion rows are hidden by visibleMessages below, so attach
			// actions to the latest renderable completion row while the extension host
			// still derives the checkpoint target from authoritative task state.
			if (message?.type === "ask" && message.ask === "completion_result" && (message.text ?? "") !== "") {
				return message.ts
			}
		}

		return undefined
	}, [messages])

	// Has to be after api_req_finished are all reduced into api_req_started messages.
	const apiMetrics = useMemo(() => getApiMetrics(modifiedMessages), [modifiedMessages])

	const [inputValue, setInputValue] = useState("")
	const inputValueRef = useRef(inputValue)
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const [sendingDisabled, setSendingDisabled] = useState(false)
	const [selectedImages, setSelectedImages] = useState<string[]>([])

	// We need to hold on to the ask because useEffect > lastMessage will always
	// let us know when an ask comes in and handle it, but by the time
	// handleMessage is called, the last message might not be the ask anymore
	// (it could be a say that followed).
	const [clineAsk, setClineAsk] = useState<ClineAsk | undefined>(undefined)
	const [enableButtons, setEnableButtons] = useState<boolean>(false)
	const [primaryButtonText, setPrimaryButtonText] = useState<string | undefined>(undefined)
	const [secondaryButtonText, setSecondaryButtonText] = useState<string | undefined>(undefined)
	const [_didClickCancel, setDidClickCancel] = useState(false)
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})
	const prevExpandedRowsRef = useRef<Record<number, boolean>>()
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const lastTtsRef = useRef<string>("")
	const [wasStreaming, setWasStreaming] = useState<boolean>(false)
	const [checkpointWarning, setCheckpointWarning] = useState<
		{ type: "WAIT_TIMEOUT" | "INIT_TIMEOUT"; timeout: number } | undefined
	>(undefined)
	const [isCondensing, setIsCondensing] = useState<boolean>(false)
	const [showAnnouncementModal, setShowAnnouncementModal] = useState(false)
	const everVisibleMessagesTsRef = useRef<LRUCache<number, boolean>>(
		new LRUCache({
			max: 100,
			ttl: 1000 * 60 * 5,
		}),
	)
	const autoApproveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const userRespondedRef = useRef<boolean>(false)
	const approvalResponseInFlightRef = useRef(false)
	const [currentFollowUpTs, setCurrentFollowUpTs] = useState<number | null>(null)
	const [aggregatedCostsMap, setAggregatedCostsMap] = useState<
		Map<
			string,
			{
				totalCost: number
				ownCost: number
				childrenCost: number
			}
		>
	>(new Map())

	const clineAskRef = useRef(clineAsk)
	useEffect(() => {
		clineAskRef.current = clineAsk
	}, [clineAsk])

	// Keep inputValueRef in sync with inputValue state
	useEffect(() => {
		inputValueRef.current = inputValue
	}, [inputValue])

	// Compute whether auto-approval is paused (user is typing in a followup)
	const isFollowUpAutoApprovalPaused = useMemo(() => {
		return !!(inputValue && inputValue.trim().length > 0 && clineAsk === "followup")
	}, [inputValue, clineAsk])

	// Cancel auto-approval timeout when user starts typing
	useEffect(() => {
		// Only send cancel if there's actual input (user is typing)
		// and we have a pending follow-up question
		if (isFollowUpAutoApprovalPaused) {
			vscode.postMessage({ type: "cancelAutoApproval" })
		}
	}, [isFollowUpAutoApprovalPaused])

	const isProfileDisabled = useMemo(
		() => !!apiConfiguration && !ProfileValidator.isProfileAllowed(apiConfiguration, organizationAllowList),
		[apiConfiguration, organizationAllowList],
	)

	// UI layout depends on the last 2 messages (since it relies on the content
	// of these messages, we are deep comparing) i.e. the button state after
	// hitting button sets enableButtons to false,  and this effect otherwise
	// would have to true again even if messages didn't change.
	const lastMessage = useMemo(() => messages.at(-1), [messages])
	const secondLastMessage = useMemo(() => messages.at(-2), [messages])

	const volume = typeof soundVolume === "number" ? soundVolume : 0.5
	const [playNotification] = useSound(`${audioBaseUri}/notification.wav`, { volume, soundEnabled, interrupt: true })
	const [playCelebration] = useSound(`${audioBaseUri}/celebration.wav`, { volume, soundEnabled, interrupt: true })
	const [playProgressLoop] = useSound(`${audioBaseUri}/progress_loop.wav`, { volume, soundEnabled, interrupt: true })

	const lastPlayedRef = useRef<Record<string, number>>({})

	const playSound = useCallback(
		(audioType: AudioType) => {
			if (!soundEnabled) {
				return
			}

			const now = Date.now()
			const lastPlayed = lastPlayedRef.current[audioType] ?? 0
			if (now - lastPlayed < 100) {
				return
			} // debounce: skip if played within 100ms
			lastPlayedRef.current[audioType] = now

			switch (audioType) {
				case "notification":
					playNotification()
					break
				case "celebration":
					playCelebration()
					break
				case "progress_loop":
					playProgressLoop()
					break
				default:
					console.warn(`Unknown audio type: ${audioType}`)
			}
		},
		[soundEnabled, playNotification, playCelebration, playProgressLoop],
	)

	function playTts(text: string) {
		vscode.postMessage({ type: "playTts", text })
	}

	useDeepCompareEffect(() => {
		// if last message is an ask, show user ask UI
		// if user finished a task, then start a new task with a new conversation history since in this moment that the extension is waiting for user response, the user could close the extension and the conversation history would be lost.
		// basically as long as a task is active, the conversation history will be persisted
		if (lastMessage) {
			switch (lastMessage.type) {
				case "ask":
					// Skip button setup when the ask was already resolved by the backend
					// before the state snapshot reached the webview. isAnswered:true is
					// stamped on the message atomically with addToClineMessages, so the
					// webview never needs to show -- and then clear -- approval buttons.
					if (lastMessage.isAnswered) {
						break
					}
					// Reset response guards when a new unresolved ask arrives.
					userRespondedRef.current = false
					approvalResponseInFlightRef.current = false
					const isPartial = lastMessage.partial === true
					switch (lastMessage.ask) {
						case "api_req_failed":
							if (!isComposerOnly) {
								playSound("progress_loop")
							}
							setSendingDisabled(true)
							setClineAsk("api_req_failed")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:retry.title"))
							setSecondaryButtonText(t("chat:startNewTask.title"))
							break
						case "mistake_limit_reached":
							if (!isComposerOnly) {
								playSound("progress_loop")
							}
							setSendingDisabled(false)
							setClineAsk("mistake_limit_reached")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:proceedAnyways.title"))
							setSecondaryButtonText(t("chat:startNewTask.title"))
							break
						case "followup":
							setSendingDisabled(isPartial)
							setClineAsk("followup")
							// setting enable buttons to `false` would trigger a focus grab when
							// the text area is enabled which is undesirable.
							// We have no buttons for this tool, so no problem having them "enabled"
							// to workaround this issue.  See #1358.
							setEnableButtons(true)
							setPrimaryButtonText(undefined)
							setSecondaryButtonText(undefined)
							break
						case "tool":
							setSendingDisabled(isPartial)
							setClineAsk("tool")
							setEnableButtons(!isPartial)
							const tool = JSON.parse(lastMessage.text || "{}") as ClineSayTool
							switch (tool.tool) {
								case "editedExistingFile":
								case "appliedDiff":
								case "newFileCreated":
									if (tool.batchDiffs && Array.isArray(tool.batchDiffs)) {
										setPrimaryButtonText(t("chat:edit-batch.approve.title"))
										setSecondaryButtonText(t("chat:edit-batch.deny.title"))
									} else {
										setPrimaryButtonText(t("chat:save.title"))
										setSecondaryButtonText(t("chat:reject.title"))
									}
									break
								case "generateImage":
									setPrimaryButtonText(t("chat:save.title"))
									setSecondaryButtonText(t("chat:reject.title"))
									break
								case "finishTask":
									setPrimaryButtonText(t("chat:completeSubtaskAndReturn"))
									setSecondaryButtonText(undefined)
									break
								case "readFile":
									if (tool.batchFiles && Array.isArray(tool.batchFiles)) {
										setPrimaryButtonText(t("chat:read-batch.approve.title"))
										setSecondaryButtonText(t("chat:read-batch.deny.title"))
									} else {
										setPrimaryButtonText(t("chat:approve.title"))
										setSecondaryButtonText(t("chat:reject.title"))
									}
									break
								case "listFilesTopLevel":
								case "listFilesRecursive":
									if (tool.batchDirs && Array.isArray(tool.batchDirs)) {
										setPrimaryButtonText(t("chat:list-batch.approve.title"))
										setSecondaryButtonText(t("chat:list-batch.deny.title"))
									} else {
										setPrimaryButtonText(t("chat:approve.title"))
										setSecondaryButtonText(t("chat:reject.title"))
									}
									break
								default:
									setPrimaryButtonText(t("chat:approve.title"))
									setSecondaryButtonText(t("chat:reject.title"))
									break
							}
							break
						case "command":
							setSendingDisabled(isPartial)
							setClineAsk("command")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:runCommand.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "use_mcp_server":
							setSendingDisabled(isPartial)
							setClineAsk("use_mcp_server")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:approve.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "external_tool_result":
							setSendingDisabled(isPartial)
							setClineAsk("external_tool_result")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:externalToolResult.return.title"))
							setSecondaryButtonText(t("chat:externalToolResult.reject.title"))
							break
						case "completion_result":
							// Extension waiting for feedback, but we can just present a new task button.
							// Kilo-style change inspection/restoration buttons are rendered inline on the completion row.
							// Only play celebration sound if there are no queued messages.
							if (!isComposerOnly && !isPartial && messageQueue.length === 0) {
								playSound("celebration")
							}
							setSendingDisabled(isPartial)
							setClineAsk("completion_result")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:startNewTask.title"))
							setSecondaryButtonText(undefined)
							break
						case "resume_task":
							setSendingDisabled(false)
							setClineAsk("resume_task")
							setEnableButtons(true)
							// Every historical task, including completed subtasks, can continue
							// from its own chat history. Completion only controls whether a result
							// is eligible to call back to its parent, not whether it is resumable.
							setPrimaryButtonText(t("chat:resumeTask.title"))
							setSecondaryButtonText(t("chat:terminate.title"))
							setDidClickCancel(false) // special case where we reset the cancel button state
							break
						case "resume_completed_task":
							setSendingDisabled(false)
							setClineAsk("resume_completed_task")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:startNewTask.title"))
							setSecondaryButtonText(undefined)
							setDidClickCancel(false)
							break
					}
					break
				case "say":
					// Don't want to reset since there could be a "say" after
					// an "ask" while ask is waiting for response.
					switch (lastMessage.say) {
						case "api_req_retry_delayed":
						case "api_req_rate_limit_wait":
							setSendingDisabled(true)
							break
						case "api_req_started":
							// Clear button state when a new API request starts
							// This fixes buttons persisting when the task continues
							setSendingDisabled(true)
							// Note: Do NOT clear selectedImages here. This handler fires
							// every time the backend starts an API call, which would wipe
							// images the user has pasted while the chat is in progress.
							// Images are already cleared in the appropriate user-action
							// handlers (handleSendMessage, handlePrimaryButtonClick, etc.).
							setClineAsk(undefined)
							setEnableButtons(false)
							setPrimaryButtonText(undefined)
							setSecondaryButtonText(undefined)
							break
						case "api_req_finished":
						case "error":
						case "text":
						case "command_output":
							break
						case "mcp_server_request_started":
						case "mcp_server_response":
						case "completion_result":
							break
					}
					break
			}
		}
	}, [lastMessage, secondLastMessage])

	// Update button text when messages change (e.g., completion_result is added) for subtasks in resume_task state
	useEffect(() => {
		if (clineAsk === "resume_task" && currentTaskItem?.parentTaskId) {
			const hasCompletionResult = messages.some(
				(msg) => msg.ask === "completion_result" || msg.say === "completion_result",
			)
			if (hasCompletionResult) {
				setPrimaryButtonText(t("chat:startNewTask.title"))
				setSecondaryButtonText(undefined)
			}
		}
	}, [clineAsk, currentTaskItem?.parentTaskId, messages, t])

	useEffect(() => {
		if (messages.length === 0) {
			setSendingDisabled(false)
			setClineAsk(undefined)
			setEnableButtons(false)
			setPrimaryButtonText(undefined)
			setSecondaryButtonText(undefined)
		}
	}, [messages.length])

	// Reset UI states when task changes. Scroll lifecycle is handled by
	// useScrollLifecycle which has its own effect keyed on taskTs.
	useEffect(() => {
		setExpandedRows({})
		everVisibleMessagesTsRef.current.clear()
		setCurrentFollowUpTs(null)
		setIsCondensing(false)

		if (autoApproveTimeoutRef.current) {
			clearTimeout(autoApproveTimeoutRef.current)
			autoApproveTimeoutRef.current = null
		}
		userRespondedRef.current = false
	}, [task?.ts])

	const taskTs = task?.ts

	// Request aggregated costs when task changes and has childIds
	useEffect(() => {
		if (!isComposerOnly && taskTs && currentTaskItem?.childIds && currentTaskItem.childIds.length > 0) {
			vscode.postMessage({
				type: "getTaskWithAggregatedCosts",
				text: currentTaskItem.id,
			})
		}
	}, [isComposerOnly, taskTs, currentTaskItem?.id, currentTaskItem?.childIds])

	useEffect(() => {
		if (isHidden) {
			everVisibleMessagesTsRef.current.clear()
		}
	}, [isHidden])

	useEffect(() => {
		const cache = everVisibleMessagesTsRef.current
		return () => {
			cache.clear()
		}
	}, [])

	const isStreaming = useMemo(() => {
		// Checking clineAsk isn't enough since messages effect may be called
		// again for a tool for example, set clineAsk to its value, and if the
		// next message is not an ask then it doesn't reset. This is likely due
		// to how much more often we're updating messages as compared to before,
		// and should be resolved with optimizations as it's likely a rendering
		// bug. But as a final guard for now, the cancel button will show if the
		// last message is not an ask.
		const isLastAsk = !!modifiedMessages.at(-1)?.ask

		const isToolCurrentlyAsking =
			isLastAsk && clineAsk !== undefined && enableButtons && primaryButtonText !== undefined

		if (isToolCurrentlyAsking) {
			return false
		}

		const isLastMessagePartial = modifiedMessages.at(-1)?.partial === true

		if (isLastMessagePartial) {
			return true
		} else {
			const lastApiReqStarted = findLast(
				modifiedMessages,
				(message: ClineMessage) => message.say === "api_req_started",
			)

			if (
				lastApiReqStarted &&
				lastApiReqStarted.text !== null &&
				lastApiReqStarted.text !== undefined &&
				lastApiReqStarted.say === "api_req_started"
			) {
				const cost = JSON.parse(lastApiReqStarted.text).cost

				if (cost === undefined) {
					return true // API request has not finished yet.
				}
			}
		}

		return false
	}, [modifiedMessages, clineAsk, enableButtons, primaryButtonText])

	const canStopTask = useMemo(() => {
		if (!task) {
			return false
		}

		const lastApiRequest = findLast(modifiedMessages, (message: ClineMessage) => message.say === "api_req_started")
		const hasStreamingFailure = (() => {
			if (!lastApiRequest?.text) {
				return false
			}

			try {
				return JSON.parse(lastApiRequest.text).cancelReason === "streaming_failed"
			} catch {
				return false
			}
		})()

		if (hasStreamingFailure) {
			return true
		}

		const lastMessage = messages.at(-1)
		if (
			(lastMessage?.type === "say" && lastMessage.say === "task_manually_stopped") ||
			clineAsk === "completion_result" ||
			clineAsk === "resume_task" ||
			clineAsk === "resume_completed_task"
		) {
			return false
		}

		const isWaitingForUserInteraction =
			clineAsk === "followup" || (clineAsk !== undefined && enableButtons && primaryButtonText !== undefined)

		return !isWaitingForUserInteraction
	}, [task, messages, modifiedMessages, clineAsk, enableButtons, primaryButtonText])

	const markFollowUpAsAnswered = useCallback(() => {
		const lastFollowUpMessage = messagesRef.current.findLast((msg: ClineMessage) => msg.ask === "followup")
		if (lastFollowUpMessage) {
			setCurrentFollowUpTs(lastFollowUpMessage.ts)
		}
	}, [])

	const clearChatInput = useCallback(() => {
		if (!replaceTextAreaValue(textAreaRef.current, "")) {
			// Fallback for browsers that do not support execCommand. This does not preserve
			// the native undo stack, but it keeps the controlled input state in sync.
			setInputValue("")
		}
	}, [])

	const clearChatInputAndImages = useCallback(() => {
		clearChatInput()
		setSelectedImages([])
	}, [clearChatInput])

	const handleChatReset = useCallback(() => {
		// Clear any pending auto-approval timeout
		if (autoApproveTimeoutRef.current) {
			clearTimeout(autoApproveTimeoutRef.current)
			autoApproveTimeoutRef.current = null
		}
		// Reset user response flag for new message
		userRespondedRef.current = false

		// Only reset message-specific state, preserving mode.
		clearChatInputAndImages()
		setSendingDisabled(true)
		setClineAsk(undefined)
		setEnableButtons(false)
		// Do not reset mode here as it should persist.
		// setPrimaryButtonText(undefined)
		// setSecondaryButtonText(undefined)
	}, [clearChatInputAndImages])

	/**
	 * Handles sending messages to the extension
	 * @param text - The message text to send
	 * @param images - Array of image data URLs to send with the message
	 */
	const handleSendMessage = useCallback(
		(text: string, images: string[]) => {
			text = text.trim()

			if (text || images.length > 0) {
				// Intercept when the active provider is retired — show a
				// WarningRow instead of sending anything to the backend.
				if (apiConfiguration?.apiProvider && isRetiredProvider(apiConfiguration.apiProvider)) {
					setShowRetiredProviderWarning(true)
					return
				}

				// Queue message if:
				// - Task is busy (sendingDisabled)
				// - API request in progress (isStreaming)
				// - Queue has items (preserve message order during drain)
				if (sendingDisabled || isStreaming || messageQueue.length > 0) {
					try {
						console.log("queueMessage", text, images)
						vscode.postMessage({ type: "queueMessage", text, images })
						clearChatInputAndImages()
					} catch (error) {
						console.error(
							`Failed to queue message: ${error instanceof Error ? error.message : String(error)}`,
						)
					}

					return
				}

				// Mark that user has responded - this prevents any pending auto-approvals.
				userRespondedRef.current = true

				if (messagesRef.current.length === 0) {
					vscode.postMessage({ type: "newTask", text, images })
				} else if (clineAskRef.current) {
					if (clineAskRef.current === "followup") {
						markFollowUpAsAnswered()
					}

					// Use clineAskRef.current
					switch (
						clineAskRef.current // Use clineAskRef.current
					) {
						case "followup":
						case "tool":
						case "command": // User can provide feedback to a tool or command use.
						case "use_mcp_server":
						case "completion_result": // If this happens then the user has feedback for the completion result.
						case "resume_task":
						case "resume_completed_task":
						case "mistake_limit_reached":
							vscode.postMessage({
								type: "askResponse",
								askResponse: "messageResponse",
								text,
								images,
							})
							break
						// There is no other case that a textfield should be enabled.
					}
				} else {
					// This is a new message in an ongoing task.
					vscode.postMessage({ type: "askResponse", askResponse: "messageResponse", text, images })
				}

				handleChatReset()
			}
		},
		[
			handleChatReset,
			markFollowUpAsAnswered,
			clearChatInputAndImages,
			sendingDisabled,
			isStreaming,
			messageQueue.length,
			apiConfiguration?.apiProvider,
		], // messagesRef and clineAskRef are stable
	)

	const handleSetChatBoxMessage = useCallback(
		(text: string, images: string[]) => {
			// Avoid nested template literals by breaking down the logic
			let newValue = text

			if (inputValue !== "") {
				newValue = inputValue + " " + text
			}

			setInputValue(newValue)
			setSelectedImages([...selectedImages, ...images])
		},
		[inputValue, selectedImages],
	)

	const startNewTask = useCallback(() => {
		setShowRetiredProviderWarning(false)
		vscode.postMessage({ type: "clearTask" })
	}, [])

	// Handle stop button click from textarea
	const handleStopTask = useCallback(() => {
		vscode.postMessage({ type: "cancelTask" })
		setDidClickCancel(true)
	}, [setDidClickCancel])

	// Handle enqueue button click from textarea
	const handleEnqueueCurrentMessage = useCallback(() => {
		const text = inputValue.trim()
		if (text || selectedImages.length > 0) {
			vscode.postMessage({
				type: "queueMessage",
				text,
				images: selectedImages,
			})
			clearChatInputAndImages()
		}
	}, [inputValue, selectedImages, clearChatInputAndImages])

	const beginApprovalResponse = useCallback(() => {
		if (approvalResponseInFlightRef.current) {
			return false
		}

		approvalResponseInFlightRef.current = true
		setEnableButtons(false)
		return true
	}, [])

	// Resets the approval button UI to its hidden/disabled state. Shared by the
	// manual click handlers and by the backend-driven clearApprovalButtons
	// message so auto-approved/denied asks hide the buttons through the same
	// pathway a manual click uses.
	const clearApprovalButtons = useCallback(() => {
		setSendingDisabled(true)
		setClineAsk(undefined)
		setEnableButtons(false)
		setPrimaryButtonText(undefined)
		setSecondaryButtonText(undefined)
	}, [])

	// This logic depends on the useEffect[messages] above to set clineAsk,
	// after which buttons are shown and we then send an askResponse to the
	// extension.
	const handlePrimaryButtonClick = useCallback(
		(text?: string, images?: string[]) => {
			if (!beginApprovalResponse()) {
				return
			}

			// Mark that user has responded
			userRespondedRef.current = true

			const trimmedInput = text?.trim()

			switch (clineAsk) {
				case "api_req_failed":
				case "command":
				case "tool":
				case "use_mcp_server":
				case "external_tool_result":
				case "mistake_limit_reached":
					// Only send text/images if they exist
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "yesButtonClicked",
							text: trimmedInput,
							images: images,
						})
						clearChatInputAndImages()
					} else {
						vscode.postMessage({ type: "askResponse", askResponse: "yesButtonClicked" })
					}
					break
				case "resume_task":
					// A message response preserves the draft as user feedback while resuming.
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "messageResponse",
							text: trimmedInput,
							images: images,
						})
						clearChatInputAndImages()
					} else {
						vscode.postMessage({ type: "askResponse", askResponse: "yesButtonClicked" })
					}
					break
				case "completion_result":
					startNewTask()
					break
				case "resume_completed_task":
					// Waiting for feedback, but we can just present a new task button
					startNewTask()
					break
			}

			clearApprovalButtons()
		},
		[beginApprovalResponse, clineAsk, startNewTask, clearApprovalButtons, clearChatInputAndImages],
	)

	const handleSecondaryButtonClick = useCallback(
		(text?: string, images?: string[]) => {
			if (!beginApprovalResponse()) {
				return
			}

			// Mark that user has responded
			userRespondedRef.current = true

			const trimmedInput = text?.trim()

			if (isStreaming) {
				vscode.postMessage({ type: "cancelTask" })
				setDidClickCancel(true)
				return
			}

			switch (clineAsk) {
				case "api_req_failed":
				case "mistake_limit_reached":
				case "resume_task":
					startNewTask()
					break
				case "command":
				case "tool":
				case "use_mcp_server":
				case "external_tool_result":
					// Only send text/images if they exist
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "noButtonClicked",
							text: trimmedInput,
							images: images,
						})
						clearChatInputAndImages()
					} else {
						// Responds to the API with a "This operation failed" and lets it try again
						vscode.postMessage({ type: "askResponse", askResponse: "noButtonClicked" })
					}
					break
			}
			clearApprovalButtons()
		},
		[
			beginApprovalResponse,
			clineAsk,
			startNewTask,
			isStreaming,
			setDidClickCancel,
			clearApprovalButtons,
			clearChatInputAndImages,
		],
	)

	const { info: model } = useSelectedModel(apiConfiguration)

	const selectImages = useCallback(() => vscode.postMessage({ type: "selectImages" }), [])

	const shouldDisableImages = !model?.supportsImages || selectedImages.length >= MAX_IMAGES_PER_MESSAGE

	const handleMessage = useCallback(
		(e: MessageEvent) => {
			const message: ExtensionMessage = e.data

			switch (message.type) {
				case "action":
					switch (message.action!) {
						case "didBecomeVisible":
							if (!isHidden && !sendingDisabled && !enableButtons) {
								textAreaRef.current?.focus()
							}
							break
						case "focusInput":
							textAreaRef.current?.focus()
							break
					}
					break
				case "selectedImages":
					// Only handle selectedImages if it's not for editing context
					// When context is "edit", ChatRow will handle the images
					if (message.context !== "edit") {
						setSelectedImages((prevImages: string[]) =>
							appendImages(prevImages, message.images, MAX_IMAGES_PER_MESSAGE),
						)
					}
					break
				case "invoke":
					switch (message.invoke!) {
						case "newChat":
							handleChatReset()
							break
						case "sendMessage":
							handleSendMessage(message.text ?? "", message.images ?? [])
							break
						case "setChatBoxMessage":
							handleSetChatBoxMessage(message.text ?? "", message.images ?? [])
							break
						case "primaryButtonClick":
							if (message.values?.useComposerDraft && isComposerOnly) {
								handlePrimaryButtonClick(inputValue, selectedImages)
							} else {
								handlePrimaryButtonClick(message.text ?? "", message.images ?? [])
							}
							break
						case "secondaryButtonClick":
							if (message.values?.useComposerDraft && isComposerOnly) {
								handleSecondaryButtonClick(inputValue, selectedImages)
							} else {
								handleSecondaryButtonClick(message.text ?? "", message.images ?? [])
							}
							break
					}
					break
				case "condenseTaskContextStarted":
					// Handle both manual and automatic condensation start
					// We don't check the task ID because:
					// 1. There can only be one active task at a time
					// 2. Task switching resets isCondensing to false (see useEffect with task?.ts dependency)
					// 3. For new tasks, currentTaskItem may not be populated yet due to async state updates
					if (message.text) {
						setIsCondensing(true)
						// Note: sendingDisabled is only set for manual condensation via handleCondenseContext
						// Automatic condensation doesn't disable sending since the task is already running
					}
					break
				case "condenseTaskContextResponse":
					// Same reasoning as above - we trust this is for the current task
					if (message.text) {
						if (isCondensing && sendingDisabled) {
							setSendingDisabled(false)
						}
						setIsCondensing(false)
					}
					break
				case "checkpointInitWarning":
					setCheckpointWarning(message.checkpointWarning)
					break
				case "interactionRequired":
					if (!isComposerOnly) {
						playSound("notification")
					}
					break
				case "taskWithAggregatedCosts":
					if (message.text && message.aggregatedCosts) {
						setAggregatedCostsMap((prev) => {
							const newMap = new Map(prev)
							newMap.set(message.text!, message.aggregatedCosts!)
							return newMap
						})
					}
					break
			}
			// textAreaRef.current is not explicitly required here since React
			// guarantees that ref will be stable across re-renders, and we're
			// not using its value but its reference.
		},
		[
			isComposerOnly,
			isCondensing,
			isHidden,
			sendingDisabled,
			enableButtons,
			handleChatReset,
			handleSendMessage,
			handleSetChatBoxMessage,
			handlePrimaryButtonClick,
			handleSecondaryButtonClick,
			inputValue,
			selectedImages,
			setCheckpointWarning,
			playSound,
		],
	)

	useEvent("message", handleMessage)

	const visibleMessages = useMemo(() => {
		// Pre-compute checkpoint hashes that have associated user messages for O(1) lookup
		const userMessageCheckpointHashes = new Set<string>()
		modifiedMessages.forEach((msg) => {
			if (
				msg.say === "user_feedback" &&
				msg.checkpoint &&
				msg.checkpoint["type"] === "user_message" &&
				msg.checkpoint["hash"]
			) {
				userMessageCheckpointHashes.add(msg.checkpoint["hash"] as string)
			}
		})

		// Remove the 500-message limit to prevent array index shifting
		// Virtuoso is designed to efficiently handle large lists through virtualization
		const newVisibleMessages = modifiedMessages.filter((message) => {
			// Filter out checkpoint_saved messages that should be suppressed
			if (message.say === "checkpoint_saved") {
				// Check if this checkpoint has the suppressMessage flag set
				if (
					message.checkpoint &&
					typeof message.checkpoint === "object" &&
					"suppressMessage" in message.checkpoint &&
					message.checkpoint.suppressMessage
				) {
					return false
				}
				// Also filter out checkpoint messages associated with user messages (legacy behavior)
				if (message.text && userMessageCheckpointHashes.has(message.text)) {
					return false
				}
			}

			if (everVisibleMessagesTsRef.current.has(message.ts)) {
				const alwaysHiddenOnceProcessedAsk: ClineAsk[] = [
					"api_req_failed",
					"resume_task",
					"resume_completed_task",
				]
				const alwaysHiddenOnceProcessedSay = [
					"api_req_finished",
					"api_req_retried",
					"api_req_deleted",
					"mcp_server_request_started",
				]
				if (message.ask && alwaysHiddenOnceProcessedAsk.includes(message.ask)) return false
				if (message.say && alwaysHiddenOnceProcessedSay.includes(message.say)) return false
				if (message.say === "text" && (message.text ?? "") === "" && (message.images?.length ?? 0) === 0) {
					return false
				}
				return true
			}

			switch (message.ask) {
				case "completion_result":
					if (message.text === "") return false
					break
				case "api_req_failed":
				case "resume_task":
				case "resume_completed_task":
					return false
			}
			switch (message.say) {
				case "api_req_finished":
				case "api_req_retried":
				case "api_req_deleted":
					return false
				case "api_req_retry_delayed":
				case "api_req_rate_limit_wait":
					const last1 = modifiedMessages.at(-1)
					const last2 = modifiedMessages.at(-2)
					if (last1?.ask === "resume_task" && last2 === message) {
						return true
					} else if (message !== last1) {
						return false
					}
					break
				case "text":
					if ((message.text ?? "") === "" && (message.images?.length ?? 0) === 0) return false
					break
				case "mcp_server_request_started":
					return false
			}
			return true
		})

		const viewportStart = Math.max(0, newVisibleMessages.length - 100)
		newVisibleMessages
			.slice(viewportStart)
			.forEach((msg: ClineMessage) => everVisibleMessagesTsRef.current.set(msg.ts, true))

		return newVisibleMessages
	}, [modifiedMessages])

	useEffect(() => {
		const cleanupInterval = setInterval(() => {
			const cache = everVisibleMessagesTsRef.current
			const currentMessageIds = new Set(modifiedMessages.map((m: ClineMessage) => m.ts))
			const viewportMessages = visibleMessages.slice(Math.max(0, visibleMessages.length - 100))
			const viewportMessageIds = new Set(viewportMessages.map((m: ClineMessage) => m.ts))

			cache.forEach((_value: boolean, key: number) => {
				if (!currentMessageIds.has(key) && !viewportMessageIds.has(key)) {
					cache.delete(key)
				}
			})
		}, 60000)

		return () => clearInterval(cleanupInterval)
	}, [modifiedMessages, visibleMessages])

	useDebounceEffect(
		() => {
			if (!isHidden && !sendingDisabled && !enableButtons) {
				textAreaRef.current?.focus()
			}
		},
		50,
		[isHidden, sendingDisabled, enableButtons],
	)

	useEffect(() => {
		// This ensures the first message is not read, future user messages are
		// labeled as `user_feedback`.
		if (!isComposerOnly && lastMessage && messages.length > 1) {
			if (
				typeof lastMessage.text === "string" && // has text (must be string for startsWith)
				(lastMessage.say === "text" || lastMessage.say === "completion_result") && // is a text message
				!lastMessage.partial && // not a partial message
				!lastMessage.text.startsWith("{") // not a json object
			) {
				let text = lastMessage?.text || ""
				const mermaidRegex = /```mermaid[\s\S]*?```/g
				// remove mermaid diagrams from text
				text = text.replace(mermaidRegex, "")
				// remove markdown from text
				text = removeMd(text)

				// ensure message is not a duplicate of last read message
				if (text !== lastTtsRef.current) {
					try {
						playTts(text)
						lastTtsRef.current = text
					} catch (error) {
						console.error("Failed to execute text-to-speech:", error)
					}
				}
			}
		}

		// Update previous value.
		setWasStreaming(isStreaming)
	}, [isComposerOnly, isStreaming, lastMessage, wasStreaming, messages.length])

	const groupedMessages = useMemo(() => {
		const filtered: ClineMessage[] = visibleMessages

		// Helper to check if a message is a read_file ask that should be batched
		const isReadFileAsk = (msg: ClineMessage): boolean => {
			if (msg.type !== "ask" || msg.ask !== "tool") return false
			try {
				const tool = JSON.parse(msg.text || "{}")
				return tool.tool === "readFile" && !tool.batchFiles // Don't re-batch already batched
			} catch {
				return false
			}
		}

		// Helper to check if a message is a list_files ask that should be batched
		const isListFilesAsk = (msg: ClineMessage): boolean => {
			if (msg.type !== "ask" || msg.ask !== "tool") return false
			try {
				const tool = JSON.parse(msg.text || "{}")
				return (
					(tool.tool === "listFilesTopLevel" || tool.tool === "listFilesRecursive") && !tool.batchDirs // Don't re-batch already batched
				)
			} catch {
				return false
			}
		}

		// Set of tool names that represent file-editing operations
		const editFileTools = new Set([
			"editedExistingFile",
			"appliedDiff",
			"newFileCreated",
			"insertContent",
			"searchAndReplace",
		])

		// Helper to check if a message is a file-edit ask that should be batched
		const isEditFileAsk = (msg: ClineMessage): boolean => {
			if (msg.type !== "ask" || msg.ask !== "tool") return false
			try {
				const tool = JSON.parse(msg.text || "{}")
				return editFileTools.has(tool.tool) && !tool.batchDiffs // Don't re-batch already batched
			} catch {
				return false
			}
		}

		// Synthesize a batch of consecutive read_file asks into a single message
		const synthesizeReadFileBatch = (batch: ClineMessage[]): ClineMessage => {
			const batchFiles = batch.map((batchMsg) => {
				try {
					const tool = JSON.parse(batchMsg.text || "{}")
					return {
						path: tool.path || "",
						lineSnippet: tool.reason || "",
						isOutsideWorkspace: tool.isOutsideWorkspace || false,
						key: `${tool.path}${tool.reason ? ` (${tool.reason})` : ""}`,
						content: tool.content || "",
					}
				} catch {
					return { path: "", lineSnippet: "", key: "", content: "" }
				}
			})

			let firstTool
			try {
				firstTool = JSON.parse(batch[0].text || "{}")
			} catch {
				return batch[0]
			}
			return {
				...batch[0],
				text: JSON.stringify({ ...firstTool, batchFiles }),
			}
		}

		// Synthesize a batch of consecutive list_files asks into a single message
		const synthesizeListFilesBatch = (batch: ClineMessage[]): ClineMessage => {
			const batchDirs = batch.map((batchMsg) => {
				try {
					const tool = JSON.parse(batchMsg.text || "{}")
					return {
						path: tool.path || "",
						recursive: tool.tool === "listFilesRecursive",
						isOutsideWorkspace: tool.isOutsideWorkspace || false,
						key: tool.path || "",
					}
				} catch {
					return { path: "", recursive: false, key: "" }
				}
			})

			let firstTool
			try {
				firstTool = JSON.parse(batch[0].text || "{}")
			} catch {
				return batch[0]
			}
			return {
				...batch[0],
				text: JSON.stringify({ ...firstTool, batchDirs }),
			}
		}

		// Synthesize a batch of consecutive file-edit asks into a single message
		const synthesizeEditFileBatch = (batch: ClineMessage[]): ClineMessage => {
			const batchDiffs = batch.map((batchMsg) => {
				try {
					const tool = JSON.parse(batchMsg.text || "{}")
					return {
						path: tool.path || "",
						changeCount: 1,
						key: tool.path || "",
						content: tool.content || tool.diff || "",
						diffStats: tool.diffStats,
					}
				} catch {
					return { path: "", changeCount: 0, key: "", content: "" }
				}
			})

			let firstTool
			try {
				firstTool = JSON.parse(batch[0].text || "{}")
			} catch {
				return batch[0]
			}
			return {
				...batch[0],
				text: JSON.stringify({ ...firstTool, batchDiffs }),
			}
		}

		// Consolidate tool asks into batches, allowing ignorable messages between targets.
		// batchNearby skips over api_req_started, empty text rows, and reasoning rows that
		// models like qwen insert between tool calls during streaming.
		const readFileBatched = batchNearby(filtered, {
			isTarget: isReadFileAsk,
			isIgnorableBetweenTargets,
			isBoundary,
			synthesize: synthesizeReadFileBatch,
		})
		const listFilesBatched = batchNearby(readFileBatched, {
			isTarget: isListFilesAsk,
			isIgnorableBetweenTargets,
			isBoundary,
			synthesize: synthesizeListFilesBatch,
		})
		const result = batchNearby(listFilesBatched, {
			isTarget: isEditFileAsk,
			isIgnorableBetweenTargets,
			isBoundary,
			synthesize: synthesizeEditFileBatch,
		})

		if (isCondensing) {
			result.push({
				type: "say",
				say: "condense_context",
				ts: Date.now(),
				partial: true,
			} as ClineMessage)
		}
		return result
	}, [isCondensing, visibleMessages])

	const checkpointIndices = useMemo(() => {
		const indices: number[] = []
		for (let i = 0; i < groupedMessages.length; i++) {
			if (groupedMessages[i]?.say === "checkpoint_saved") {
				indices.push(i)
			}
		}
		return indices
	}, [groupedMessages])

	const contentChangeKey = useMemo(
		() => groupedMessages.map((message) => `${message.ts}:${message.partial}:${message.text ?? ""}`).join("|"),
		[groupedMessages],
	)

	const hasLatestCheckpoint = checkpointIndices.length > 0
	const checkpointJumpCursorRef = useRef<number | null>(null)

	useEffect(() => {
		checkpointJumpCursorRef.current = null
	}, [task?.ts, checkpointIndices.length])

	// Scroll lifecycle is managed by a dedicated hook to keep ChatView focused
	// on message handling and UI orchestration.
	const {
		showScrollToBottom,
		handleRowHeightChange,
		handleContentHeightChange,
		handleScrollToBottomClick,
		enterUserBrowsingHistory,
		followOutputCallback,
		atBottomStateChangeCallback,
	} = useScrollLifecycle({
		virtuosoRef,
		scrollContainerRef,
		taskTs: task?.ts,
		contentChangeKey,
		isStreaming,
		isHidden,
		hasTask: !!task,
		bottomTolerance: BOTTOM_SCROLL_TOLERANCE,
	})

	// Expanding a row indicates the user is browsing; disable sticky follow.
	// Placed after the hook call so enterUserBrowsingHistory is defined.
	useEffect(() => {
		const prev = prevExpandedRowsRef.current
		let wasAnyRowExpandedByUser = false
		if (prev) {
			for (const [tsKey, isExpanded] of Object.entries(expandedRows)) {
				const ts = Number(tsKey)
				if (isExpanded && !(prev[ts] ?? false)) {
					wasAnyRowExpandedByUser = true
					break
				}
			}
		}

		if (wasAnyRowExpandedByUser) {
			enterUserBrowsingHistory("row-expansion")
		}

		prevExpandedRowsRef.current = expandedRows
	}, [enterUserBrowsingHistory, expandedRows])

	const handleSetExpandedRow = useCallback(
		(ts: number, expand?: boolean) => {
			setExpandedRows((prev: Record<number, boolean>) => ({
				...prev,
				[ts]: expand === undefined ? !prev[ts] : expand,
			}))
		},
		[setExpandedRows], // setExpandedRows is stable
	)

	// Scroll when user toggles certain rows.
	const toggleRowExpansion = useCallback(
		(ts: number) => {
			handleSetExpandedRow(ts)
			// The logic to set disableAutoScrollRef.current = true on expansion
			// is now handled by the useEffect hook that observes expandedRows.
		},
		[handleSetExpandedRow],
	)

	// Effect to clear checkpoint warning when messages appear or task changes
	useEffect(() => {
		if (isHidden || !task) {
			setCheckpointWarning(undefined)
		}
	}, [modifiedMessages.length, isStreaming, isHidden, task])

	const placeholderText = task ? t("chat:typeMessage") : t("chat:typeTask")

	const switchToMode = useCallback(
		(modeSlug: string): void => {
			if (!getAllModes(customModes).some((modeConfig) => modeConfig.slug === modeSlug)) {
				return
			}

			// Update local state and notify extension to sync mode change.
			setMode(modeSlug)

			// Send the mode switch message.
			vscode.postMessage({ type: "mode", text: modeSlug })
		},
		[customModes, setMode],
	)

	const appendSuggestionToInput = useCallback(
		(suggestion: SuggestionItem) => {
			setInputValue((currentValue: string) => {
				return currentValue !== "" ? `${currentValue} \n${suggestion.answer}` : suggestion.answer
			})
		},
		[setInputValue],
	)

	const switchToSuggestionMode = useCallback(
		(suggestion: SuggestionItem, isManualAction: boolean) => {
			const suggestionMode = getSuggestionMode(suggestion.mode)
			if (suggestionMode && (isManualAction || alwaysAllowModeSwitch)) {
				switchToMode(suggestionMode)
			}
		},
		[alwaysAllowModeSwitch, switchToMode],
	)

	const handleSuggestionDraftInRow = useCallback(
		(suggestion: SuggestionItem) => {
			userRespondedRef.current = true
			switchToSuggestionMode(suggestion, true)

			if (isDedicatedConversation) {
				vscode.postMessage({ type: "requestComposerDraftAppend", text: suggestion.answer })
				return
			}

			appendSuggestionToInput(suggestion)
		},
		[appendSuggestionToInput, isDedicatedConversation, switchToSuggestionMode],
	)

	const handleSuggestionCopyInRow = useCallback(
		(suggestion: SuggestionItem) => {
			handleSuggestionDraftInRow(suggestion)
		},
		[handleSuggestionDraftInRow],
	)

	const handleSuggestionClickInRow = useCallback(
		(suggestion: SuggestionItem, event?: React.MouseEvent) => {
			// Mark that user has responded if this is a manual click (not auto-approval)
			if (event) {
				userRespondedRef.current = true
			}

			// Mark the current follow-up question as answered when a suggestion is clicked
			if (clineAsk === "followup" && !event?.shiftKey) {
				markFollowUpAsAnswered()
			}

			if (event?.shiftKey) {
				handleSuggestionDraftInRow(suggestion)
			} else {
				switchToSuggestionMode(suggestion, !!event)
				// Don't clear the input value when sending a follow-up choice
				// The message should be sent but the text area should preserve what the user typed
				const preservedInput = inputValueRef.current
				handleSendMessage(suggestion.answer, [])
				// Restore the input value after sending
				setInputValue(preservedInput)
			}
		},
		[
			handleSendMessage,
			setInputValue,
			switchToSuggestionMode,
			clineAsk,
			markFollowUpAsAnswered,
			handleSuggestionDraftInRow,
		],
	)

	const handleBatchFileResponse = useCallback((response: { [key: string]: boolean }) => {
		// Handle batch file response, e.g., for file uploads
		vscode.postMessage({ type: "askResponse", askResponse: "objectResponse", text: JSON.stringify(response) })
	}, [])

	// Cancel backend auto-approval timeout when FollowUpSuggest's countdown effect cleans up.
	// This is called when auto-approve is toggled off, a suggestion is clicked, or the component unmounts.
	const handleFollowUpUnmount = useCallback(() => {
		vscode.postMessage({ type: "cancelAutoApproval" })
	}, [])

	const handleScrollToBottomAndResetCheckpointCursor = useCallback(() => {
		checkpointJumpCursorRef.current = null
		handleScrollToBottomClick()
	}, [handleScrollToBottomClick])

	const handleScrollToLatestCheckpoint = useCallback(() => {
		if (checkpointIndices.length === 0) {
			return
		}

		const previousCursor = checkpointJumpCursorRef.current
		const nextCursor = previousCursor === null ? checkpointIndices.length - 1 : Math.max(0, previousCursor - 1)
		const nextCheckpointIndex = checkpointIndices[nextCursor]
		checkpointJumpCursorRef.current = nextCursor

		enterUserBrowsingHistory("keyboard-nav-up")
		virtuosoRef.current?.scrollToIndex({
			index: nextCheckpointIndex,
			align: "center",
			behavior: "smooth",
		})
	}, [checkpointIndices, enterUserBrowsingHistory])

	const itemContent = useCallback(
		(index: number, messageOrGroup: ClineMessage) => {
			const hasCheckpoint = modifiedMessages.some((message) => message.say === "checkpoint_saved")

			// regular message
			return (
				<ChatRow
					key={messageOrGroup.ts}
					message={messageOrGroup}
					isExpanded={expandedRows[messageOrGroup.ts] || false}
					onToggleExpand={toggleRowExpansion} // This was already stabilized
					lastModifiedMessage={modifiedMessages.at(-1)} // Original direct access
					isLast={index === groupedMessages.length - 1} // Original direct access
					onHeightChange={handleRowHeightChange}
					isStreaming={isStreaming}
					onSuggestionClick={handleSuggestionClickInRow} // This was already stabilized
					onSuggestionCopy={handleSuggestionCopyInRow}
					onBatchFileResponse={handleBatchFileResponse}
					onFollowUpUnmount={handleFollowUpUnmount}
					isFollowUpAnswered={messageOrGroup.isAnswered === true || messageOrGroup.ts === currentFollowUpTs}
					isFollowUpAutoApprovalPaused={isFollowUpAutoApprovalPaused}
					editable={
						messageOrGroup.type === "ask" &&
						messageOrGroup.ask === "tool" &&
						(() => {
							let tool: any = {}
							try {
								tool = JSON.parse(messageOrGroup.text || "{}")
							} catch (_) {
								if (messageOrGroup.text?.includes("updateTodoList")) {
									tool = { tool: "updateTodoList" }
								}
							}
							return tool.tool === "updateTodoList" && enableButtons && !!primaryButtonText
						})()
					}
					hasCheckpoint={hasCheckpoint}
					completionCheckpoint={messageOrGroup.ts === completionResultTs ? completionCheckpoint : undefined}
					onJumpToPreviousCheckpoint={handleScrollToLatestCheckpoint}
				/>
			)
		},
		[
			expandedRows,
			toggleRowExpansion,
			modifiedMessages,
			groupedMessages.length,
			completionCheckpoint,
			completionResultTs,
			handleRowHeightChange,
			isStreaming,
			handleSuggestionClickInRow,
			handleSuggestionCopyInRow,
			handleBatchFileResponse,
			handleFollowUpUnmount,
			currentFollowUpTs,
			isFollowUpAutoApprovalPaused,
			enableButtons,
			primaryButtonText,
			handleScrollToLatestCheckpoint,
		],
	)

	const computeMessageKey = useCallback((_index: number, messageOrGroup: ClineMessage) => {
		// Grouped items retain the first source message timestamp. Do not include
		// the mutable list index: filtering or batching rows above the viewport
		// would otherwise make Virtuoso remount later rows and visibly shift history.
		return messageOrGroup.say === "condense_context" ? "condense-context" : String(messageOrGroup.ts)
	}, [])

	// Function to handle mode switching
	const switchToNextMode = useCallback(() => {
		const allModes = getAllModes(customModes)
		const currentModeIndex = allModes.findIndex((m) => m.slug === mode)
		const nextModeIndex = (currentModeIndex + 1) % allModes.length
		// Update local state and notify extension to sync mode change
		switchToMode(allModes[nextModeIndex].slug)
	}, [mode, customModes, switchToMode])

	// Function to handle switching to previous mode
	const switchToPreviousMode = useCallback(() => {
		const allModes = getAllModes(customModes)
		const currentModeIndex = allModes.findIndex((m) => m.slug === mode)
		const previousModeIndex = (currentModeIndex - 1 + allModes.length) % allModes.length
		// Update local state and notify extension to sync mode change
		switchToMode(allModes[previousModeIndex].slug)
	}, [mode, customModes, switchToMode])

	// Mode switching keyboard handler. Scroll-intent keyboard detection
	// (PageUp, Home, ArrowUp) is handled by useScrollLifecycle.
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key === ".") {
				event.preventDefault()
				if (event.shiftKey) {
					switchToPreviousMode()
				} else {
					switchToNextMode()
				}
			}
		},
		[switchToNextMode, switchToPreviousMode],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)

		return () => {
			window.removeEventListener("keydown", handleKeyDown)
		}
	}, [handleKeyDown])

	useImperativeHandle(ref, () => ({
		acceptInput: () => {
			const hasInput = inputValue.trim() || selectedImages.length > 0

			if (enableButtons && primaryButtonText) {
				handlePrimaryButtonClick(inputValue, selectedImages)
			} else if (!sendingDisabled && !isProfileDisabled && hasInput) {
				handleSendMessage(inputValue, selectedImages)
			}
		},
	}))

	const handleCondenseContext = (taskId: string) => {
		if (isCondensing || sendingDisabled) {
			return
		}
		setIsCondensing(true)
		setSendingDisabled(true)
		vscode.postMessage({ type: "condenseTaskContextRequest", text: taskId })
	}

	const areButtonsVisible = showScrollToBottom || primaryButtonText || secondaryButtonText
	const hasFileChanges = useMemo(() => fileChangesFromMessages(messages).length > 0, [messages])
	const hasTaskBottomOverlay = areButtonsVisible || hasFileChanges
	const hasTwoBottomOverlayRows = areButtonsVisible && hasFileChanges
	const bottomOverlayHeightClass = hasTwoBottomOverlayRows ? "h-20 min-[760px]:h-10" : "h-10"

	return (
		<div
			data-testid="chat-view"
			className={
				isHidden || isInactiveComposer
					? "hidden"
					: "absolute inset-0 flex h-full min-h-0 w-full flex-col overflow-hidden"
			}>
			{/* The bottom composer deliberately stays visually neutral and never renders the chat background image. */}
			{!isComposerOnly && (
				<div data-testid="chat-background-image" style={backgroundImageStyle as React.CSSProperties} />
			)}
			{/* Content layer */}
			<div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
				{!isComposerOnly && telemetrySetting === "unset" && <TelemetryBanner />}
				{!isComposerOnly && (showAnnouncement || showAnnouncementModal) && (
					<Announcement
						hideAnnouncement={() => {
							if (showAnnouncementModal) {
								setShowAnnouncementModal(false)
							}
							if (showAnnouncement) {
								hideAnnouncement()
							}
						}}
					/>
				)}
				{!isComposerOnly &&
					(task ? (
						<>
							<TaskHeader
								task={task}
								tokensIn={apiMetrics.totalTokensIn}
								tokensOut={apiMetrics.totalTokensOut}
								cacheWrites={apiMetrics.totalCacheWrites}
								cacheReads={apiMetrics.totalCacheReads}
								totalCost={apiMetrics.totalCost}
								aggregatedCost={
									currentTaskItem?.id && aggregatedCostsMap.has(currentTaskItem.id)
										? aggregatedCostsMap.get(currentTaskItem.id)!.totalCost
										: undefined
								}
								hasSubtasks={
									!!(
										currentTaskItem?.id &&
										aggregatedCostsMap.has(currentTaskItem.id) &&
										aggregatedCostsMap.get(currentTaskItem.id)!.childrenCost > 0
									)
								}
								parentTaskId={currentTaskItem?.parentTaskId}
								costBreakdown={
									currentTaskItem?.id && aggregatedCostsMap.has(currentTaskItem.id)
										? getCostBreakdownIfNeeded(aggregatedCostsMap.get(currentTaskItem.id)!, {
												own: t("common:costs.own"),
												subtasks: t("common:costs.subtasks"),
											})
										: undefined
								}
								contextTokens={apiMetrics.contextTokens}
								buttonsDisabled={sendingDisabled}
								handleCondenseContext={handleCondenseContext}
								todos={latestTodos}
							/>

							{checkpointWarning && (
								<div className="px-3">
									<CheckpointWarning warning={checkpointWarning} />
								</div>
							)}
						</>
					) : (
						<div className="flex flex-col h-full p-6 min-h-0 overflow-y-auto gap-4 relative">
							<div
								className={`flex flex-col items-start gap-2 min-[400px]:px-6 ${
									backgroundImageEnabled ? "mt-auto" : "my-auto"
								}`}>
								<VersionIndicator
									onClick={() => setShowAnnouncementModal(true)}
									className="absolute top-2 right-3 z-10"
								/>
								<div className="flex flex-col gap-4 w-full">
									{!backgroundImageEnabled && (
										<>
											<RooHero />
											<RooTips />
										</>
									)}
									{/* Everyone should see their task history if any */}
									{taskHistory.length > 0 && <HistoryPreview />}
								</div>
							</div>
						</div>
					))}

				{!isComposerOnly && !task && showWorktreesInHomeScreen && <WorktreeSelector />}

				{!isComposerOnly && task && (
					<div className="relative flex min-h-0 flex-1 flex-col">
						<div className="flex min-h-0 flex-1" ref={scrollContainerRef}>
							<Virtuoso
								ref={virtuosoRef}
								key={task.ts}
								className="scrollable grow overflow-y-scroll mb-1"
								computeItemKey={computeMessageKey}
								defaultItemHeight={CHAT_DEFAULT_ITEM_HEIGHT}
								increaseViewportBy={CHAT_VIEWPORT_BUFFER}
								components={{
									// Reserve only the space used by a visible bottom overlay. At the
									// wide task-header breakpoint both controls share one row.
									Footer: () =>
										hasTaskBottomOverlay ? (
											<div
												className={bottomOverlayHeightClass}
												aria-hidden="true"
												data-testid="chat-bottom-spacer"
											/>
										) : null,
								}}
								data={groupedMessages}
								itemContent={itemContent}
								followOutput={followOutputCallback}
								atBottomStateChange={atBottomStateChangeCallback}
								atBottomThreshold={BOTTOM_SCROLL_TOLERANCE}
							/>
						</div>
						{hasTaskBottomOverlay && (
							<div
								data-testid="chat-task-bottom-overlay"
								className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 ${bottomOverlayHeightClass}`}>
								<div className="pointer-events-auto flex h-full flex-col bg-vscode-editor-background/95 backdrop-blur-sm min-[760px]:flex-row">
									{hasFileChanges && (
										<div
											data-testid="chat-file-changes-slot"
											className="order-1 h-10 shrink-0 min-[760px]:order-2 min-[760px]:flex-1 min-w-0">
											<FileChangesPanel clineMessages={messages} />
										</div>
									)}
									{areButtonsVisible && (
										<div
											data-testid="chat-task-action-slot"
											className={`order-2 flex h-10 shrink-0 items-center px-[15px] min-[760px]:order-1 min-[760px]:flex-1 ${
												showScrollToBottom || enableButtons ? "opacity-100" : "opacity-50"
											}`}>
											{showScrollToBottom ? (
												<>
													<StandardTooltip content={t("chat:scrollToBottom")}>
														<Button
															variant="secondary"
															className={
																hasLatestCheckpoint ? "flex-1 mr-[6px]" : "flex-[2]"
															}
															onClick={handleScrollToBottomAndResetCheckpointCursor}>
															<span className="codicon codicon-chevron-down"></span>
														</Button>
													</StandardTooltip>
													{hasLatestCheckpoint && (
														<StandardTooltip content={t("chat:scrollToLatestCheckpoint")}>
															<Button
																variant="secondary"
																className="flex-1 ml-[6px]"
																onClick={handleScrollToLatestCheckpoint}
																aria-label={t("chat:scrollToLatestCheckpoint")}>
																<span className="codicon codicon-history"></span>
															</Button>
														</StandardTooltip>
													)}
												</>
											) : (
												<>
													{primaryButtonText && (
														<StandardTooltip
															content={
																primaryButtonText === t("chat:retry.title")
																	? t("chat:retry.tooltip")
																	: primaryButtonText === t("chat:save.title")
																		? t("chat:save.tooltip")
																		: primaryButtonText === t("chat:approve.title")
																			? t("chat:approve.tooltip")
																			: primaryButtonText ===
																				  t("chat:runCommand.title")
																				? t("chat:runCommand.tooltip")
																				: primaryButtonText ===
																					  t("chat:startNewTask.title")
																					? t("chat:startNewTask.tooltip")
																					: primaryButtonText ===
																						  t("chat:resumeTask.title")
																						? t("chat:resumeTask.tooltip")
																						: primaryButtonText ===
																							  t(
																									"chat:proceedAnyways.title",
																							  )
																							? t(
																									"chat:proceedAnyways.tooltip",
																								)
																							: primaryButtonText ===
																								  t(
																										"chat:proceedWhileRunning.title",
																								  )
																								? t(
																										"chat:proceedWhileRunning.tooltip",
																									)
																								: undefined
															}>
															<Button
																variant="primary"
																disabled={!enableButtons}
																className={
																	secondaryButtonText
																		? "flex-1 mr-[6px]"
																		: "flex-[2] mr-0"
																}
																onClick={() => {
																	if (isDedicatedConversation) {
																		if (!beginApprovalResponse()) {
																			return
																		}
																		vscode.postMessage({
																			type: "requestComposerPrimaryButtonClick",
																		})
																		return
																	}
																	handlePrimaryButtonClick(inputValue, selectedImages)
																}}>
																{primaryButtonText}
															</Button>
														</StandardTooltip>
													)}
													{secondaryButtonText && (
														<StandardTooltip
															content={
																secondaryButtonText === t("chat:startNewTask.title")
																	? t("chat:startNewTask.tooltip")
																	: secondaryButtonText === t("chat:reject.title")
																		? t("chat:reject.tooltip")
																		: secondaryButtonText ===
																			  t("chat:terminate.title")
																			? t("chat:terminate.tooltip")
																			: secondaryButtonText ===
																				  t("chat:killCommand.title")
																				? t("chat:killCommand.tooltip")
																				: undefined
															}>
															<Button
																variant="secondary"
																disabled={!enableButtons}
																className="flex-1 ml-[6px]"
																onClick={() => {
																	if (isDedicatedConversation) {
																		if (!beginApprovalResponse()) {
																			return
																		}
																		vscode.postMessage({
																			type: "requestComposerSecondaryButtonClick",
																		})
																		return
																	}
																	handleSecondaryButtonClick(
																		inputValue,
																		selectedImages,
																	)
																}}>
																{secondaryButtonText}
															</Button>
														</StandardTooltip>
													)}
												</>
											)}
										</div>
									)}
								</div>
							</div>
						)}
					</div>
				)}

				{isDedicatedConversation && (
					<ChatTextArea
						inputValue={inputValue}
						setInputValue={setInputValue}
						sendingDisabled={sendingDisabled || isProfileDisabled}
						selectApiConfigDisabled={sendingDisabled && clineAsk !== "api_req_failed"}
						placeholderText={placeholderText}
						selectedImages={selectedImages}
						setSelectedImages={setSelectedImages}
						onSend={() => handleSendMessage(inputValue, selectedImages)}
						onSelectImages={selectImages}
						shouldDisableImages={shouldDisableImages}
						mode={mode}
						setMode={setMode}
						modeShortcutText={modeShortcutText}
						controlsOnly
					/>
				)}

				{!isDedicatedConversation && (
					<>
						<QueuedMessages
							queue={messageQueue}
							onRemove={(index) => {
								if (messageQueue[index]) {
									vscode.postMessage({ type: "removeQueuedMessage", text: messageQueue[index].id })
								}
							}}
							onUpdate={(index, newText) => {
								if (messageQueue[index]) {
									vscode.postMessage({
										type: "editQueuedMessage",
										payload: {
											id: messageQueue[index].id,
											text: newText,
											images: messageQueue[index].images,
										},
									})
								}
							}}
						/>
						{showRetiredProviderWarning && (
							<div className="px-[15px] py-1">
								<WarningRow
									title={t("chat:retiredProvider.title")}
									message={t("chat:retiredProvider.message")}
									actionText={t("chat:retiredProvider.openSettings")}
									onAction={() => vscode.postMessage({ type: "switchTab", tab: "settings" })}
								/>
							</div>
						)}
						<ChatTextArea
							ref={textAreaRef}
							inputValue={inputValue}
							setInputValue={setInputValue}
							sendingDisabled={sendingDisabled || isProfileDisabled}
							selectApiConfigDisabled={sendingDisabled && clineAsk !== "api_req_failed"}
							placeholderText={placeholderText}
							selectedImages={selectedImages}
							setSelectedImages={setSelectedImages}
							onSend={() => handleSendMessage(inputValue, selectedImages)}
							onSelectImages={selectImages}
							shouldDisableImages={shouldDisableImages}
							onHeightChange={handleContentHeightChange}
							mode={mode}
							setMode={setMode}
							modeShortcutText={modeShortcutText}
							isStreaming={isStreaming}
							canStopTask={canStopTask}
							onStop={handleStopTask}
							onEnqueueMessage={handleEnqueueCurrentMessage}
						/>
					</>
				)}

				{!isDedicatedConversation && isProfileDisabled && (
					<div className="px-3">
						<ProfileViolationWarning />
					</div>
				)}

				<div id="roo-portal" />
			</div>
		</div>
	)
}

const ChatView = forwardRef(ChatViewComponent)

export default ChatView
