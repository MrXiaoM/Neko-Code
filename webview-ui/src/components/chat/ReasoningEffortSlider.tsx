import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"

import {
	type ModelInfo,
	openAiModelInfoSaneDefaults,
	type ProviderSettings,
	type ReasoningEffortExtended,
} from "@roo-code/types"

import { cn } from "@/lib/utils"
import { useAppTranslation } from "@/i18n/TranslationContext"

type ReasoningSliderValue = ReasoningEffortExtended | "disable" | "enabled" | "unavailable"

interface ReasoningEffortSliderProps {
	apiConfiguration: ProviderSettings
	configName: string
	modelId: string
	modelInfo?: ModelInfo
	disabled?: boolean
	onCommit: (
		settings: Pick<ProviderSettings, "enableReasoningEffort" | "reasoningEffort" | "openAiCustomModelInfo">,
	) => void
}

const effortOrder: ReadonlyArray<ReasoningEffortExtended> = ["none", "minimal", "low", "medium", "high", "xhigh", "max"]
const openAiCompatibleReasoningOptions: ReadonlyArray<ReasoningEffortExtended> = [
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]
const thumbDiameter = 28
const thumbRadius = thumbDiameter / 2
const activeHorizontalInset = 4
const progressThumbExtension = 4

const getOptions = (apiConfiguration: ProviderSettings, modelInfo?: ModelInfo): ReadonlyArray<ReasoningSliderValue> => {
	if (apiConfiguration.apiProvider === "openai") {
		return ["disable", ...openAiCompatibleReasoningOptions]
	}

	if (modelInfo?.supportsReasoningEffort) {
		const supportedEfforts =
			modelInfo.supportsReasoningEffort === true
				? (["low", "medium", "high"] as const)
				: modelInfo.supportsReasoningEffort
		const options = supportedEfforts.filter((value): value is ReasoningEffortExtended =>
			effortOrder.includes(value as ReasoningEffortExtended),
		)

		return modelInfo.requiredReasoningEffort ? options : ["disable", ...options]
	}

	if (
		modelInfo?.supportsReasoningBinary ||
		(modelInfo?.supportsReasoningBudget && !modelInfo.requiredReasoningBudget)
	) {
		return ["disable", "enabled"]
	}

	return ["unavailable"]
}

const getCommittedValue = (
	apiConfiguration: ProviderSettings,
	options: ReadonlyArray<ReasoningSliderValue>,
	modelInfo?: ModelInfo,
): ReasoningSliderValue => {
	if (options[0] === "unavailable") {
		return "unavailable"
	}

	if (options.includes("enabled")) {
		return apiConfiguration.enableReasoningEffort === true ? "enabled" : "disable"
	}

	if (apiConfiguration.enableReasoningEffort !== true && !modelInfo?.requiredReasoningEffort) {
		return "disable"
	}

	const configuredEffort =
		apiConfiguration.apiProvider === "openai"
			? apiConfiguration.openAiCustomModelInfo?.reasoningEffort
			: apiConfiguration.reasoningEffort

	if (apiConfiguration.enableReasoningEffort === false || configuredEffort === "disable") {
		return "disable"
	}
	if (configuredEffort && options.includes(configuredEffort)) {
		return configuredEffort
	}

	return options.find((option) => option !== "disable") ?? options[0]
}

const getSettingsForValue = (
	apiConfiguration: ProviderSettings,
	value: ReasoningSliderValue,
	isBinaryControl: boolean,
): Pick<ProviderSettings, "enableReasoningEffort" | "reasoningEffort" | "openAiCustomModelInfo"> => {
	if (apiConfiguration.apiProvider === "openai") {
		const { reasoningEffort: _, ...openAiCustomModelInfo } =
			apiConfiguration.openAiCustomModelInfo ?? openAiModelInfoSaneDefaults
		return value === "disable"
			? { enableReasoningEffort: false, openAiCustomModelInfo }
			: {
					enableReasoningEffort: true,
					openAiCustomModelInfo: {
						...openAiCustomModelInfo,
						reasoningEffort: value as ReasoningEffortExtended,
					},
				}
	}

	if (value === "disable") {
		return { enableReasoningEffort: false, reasoningEffort: isBinaryControl ? undefined : "disable" }
	}

	if (value === "enabled") {
		return { enableReasoningEffort: true, reasoningEffort: undefined }
	}

	return { enableReasoningEffort: true, reasoningEffort: value as ReasoningEffortExtended }
}

const getIntensityColor = (value: ReasoningSliderValue, index: number) => {
	if (value === "unavailable" || value === "disable") return "var(--vscode-input-border)"
	if (value === "enabled") return "var(--vscode-button-background)"
	if (value === "max") return "#3b82f6"
	if (value === "xhigh") return "#06b6d4"
	if (index >= 4) return "#d946ef"
	if (index >= 3) return "#8b5cf6"
	return "var(--vscode-button-background)"
}

const getIntensityGlow = (value: ReasoningSliderValue, index: number) => {
	if (value === "unavailable" || value === "disable") return "none"
	if (value === "max") return "0 0 16px rgba(59,130,246,0.48), 0 0 28px rgba(147,197,253,0.2)"
	if (value === "xhigh") return "0 0 16px rgba(6,182,212,0.5)"
	if (index >= 4) return "0 0 14px rgba(217,70,239,0.48)"
	if (index >= 3) return "0 0 12px rgba(139,92,246,0.42)"
	return "0 0 10px color-mix(in srgb, var(--vscode-button-background) 45%, transparent)"
}

const isLightVsCodeTheme = () => {
	const themeKind = document.body.dataset.vscodeThemeKind?.toLowerCase() ?? ""
	const themeClasses = document.body.className.toLowerCase()
	return themeKind.includes("light") || themeClasses.includes("light")
}

const getProgressGradient = (color: string, isLightTheme: boolean) => {
	const blendTarget = isLightTheme ? "white" : "black"
	const colorWeight = isLightTheme ? 70 : 78
	return `linear-gradient(90deg, color-mix(in srgb, ${color} ${colorWeight}%, ${blendTarget}), ${color})`
}

const getPositionPercentage = (index: number, optionCount: number) =>
	optionCount > 1 ? (index / (optionCount - 1)) * 100 : 0

const getThumbLeft = (index: number, optionCount: number) => {
	const percentage = getPositionPercentage(index, optionCount)
	const adjustment = (thumbDiameter + activeHorizontalInset * 2) * (percentage / 100) - activeHorizontalInset
	if (adjustment === 0) return `${percentage}%`
	return `calc(${percentage}% ${adjustment > 0 ? "-" : "+"} ${Math.abs(adjustment)}px)`
}

const getTickLeft = (index: number, optionCount: number) => {
	const percentage = getPositionPercentage(index, optionCount)
	const adjustment =
		activeHorizontalInset + thumbRadius - (thumbDiameter + activeHorizontalInset * 2) * (percentage / 100)
	if (adjustment === 0) return `${percentage}%`
	return `calc(${percentage}% ${adjustment > 0 ? "+" : "-"} ${Math.abs(adjustment)}px)`
}

const getProgressWidth = (index: number, optionCount: number) => {
	const percentage = getPositionPercentage(index, optionCount)
	const offset =
		activeHorizontalInset +
		thumbDiameter +
		progressThumbExtension -
		(thumbDiameter + activeHorizontalInset * 2) * (percentage / 100)

	if (offset === 0) return `${percentage}%`
	return `calc(${percentage}% ${offset > 0 ? "+" : "-"} ${Math.abs(offset)}px)`
}

const getProgressPattern = (value: ReasoningSliderValue) => {
	if (value === "max") {
		return {
			image: 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2276%22 height=%2238%22 viewBox=%220 0 76 38%22%3E%3Cpath fill=%22white%22 fill-opacity=%22.9%22 d=%22m16 2 2.4 7.1 7.1 2.4-7.1 2.4-2.4 7.1-2.4-7.1-7.1-2.4 7.1-2.4z%22/%3E%3Cpath fill=%22white%22 fill-opacity=%22.72%22 d=%22m52 18 1.45 4.3 4.3 1.45-4.3 1.45L52 29.5l-1.45-4.3-4.3-1.45 4.3-1.45z%22/%3E%3Cpath fill=%22white%22 fill-opacity=%22.62%22 d=%22m31 26 .9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9z%22/%3E%3Ccircle cx=%2268%22 cy=%226%22 r=%221.35%22 fill=%22white%22 fill-opacity=%22.7%22/%3E%3Ccircle cx=%224%22 cy=%2232%22 r=%221%22 fill=%22white%22 fill-opacity=%22.56%22/%3E%3C/svg%3E")',
			size: "76px 38px",
		}
	}

	if (value === "xhigh") {
		return {
			image: 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2238%22 viewBox=%220 0 60 38%22%3E%3Cpath fill=%22white%22 fill-opacity=%22.78%22 d=%22m13 4 1.8 5.2L20 11l-5.2 1.8L13 18l-1.8-5.2L6 11l5.2-1.8z%22/%3E%3Cpath fill=%22white%22 fill-opacity=%22.64%22 d=%22m42 21 1.15 3.35 3.35 1.15-3.35 1.15L42 30l-1.15-3.35-3.35-1.15 3.35-1.15z%22/%3E%3Ccircle cx=%2253%22 cy=%227%22 r=%221.2%22 fill=%22white%22 fill-opacity=%22.64%22/%3E%3Ccircle cx=%2226%22 cy=%2231%22 r=%221%22 fill=%22white%22 fill-opacity=%22.52%22/%3E%3C/svg%3E")',
			size: "60px 38px",
		}
	}

	return undefined
}

export const ReasoningEffortSlider = ({
	apiConfiguration,
	configName,
	modelId,
	modelInfo,
	disabled = false,
	onCommit,
}: ReasoningEffortSliderProps) => {
	const { t } = useAppTranslation()
	const railRef = useRef<HTMLDivElement>(null)
	const options = useMemo(() => getOptions(apiConfiguration, modelInfo), [apiConfiguration, modelInfo])
	const committedValue = useMemo(
		() => getCommittedValue(apiConfiguration, options, modelInfo),
		[apiConfiguration, modelInfo, options],
	)
	const [previewValue, setPreviewValue] = useState(committedValue)
	const initialValueRef = useRef(committedValue)
	const isDraggingRef = useRef(false)
	const dragWasCanceledRef = useRef(false)
	const [isLightTheme, setIsLightTheme] = useState(isLightVsCodeTheme)

	useEffect(() => {
		const updateThemeKind = () => setIsLightTheme(isLightVsCodeTheme())
		const observer = new MutationObserver(updateThemeKind)
		observer.observe(document.body, { attributes: true, attributeFilter: ["class", "data-vscode-theme-kind"] })
		return () => observer.disconnect()
	}, [])

	useEffect(() => {
		if (!isDraggingRef.current) {
			setPreviewValue(committedValue)
		}
	}, [committedValue])

	const isUnavailable = options[0] === "unavailable"
	const sliderDisabled = disabled || isUnavailable || options.length < 2
	const isBinaryControl = options.includes("enabled")
	const previewIndex = Math.max(0, options.indexOf(previewValue))
	const currentLabel =
		previewValue === "unavailable"
			? t("chat:apiConfigSelector.reasoningUnavailable")
			: previewValue === "disable"
				? t("chat:apiConfigSelector.reasoningOff")
				: previewValue === "enabled"
					? t("chat:apiConfigSelector.reasoningOn")
					: t(`settings:providers.reasoningEffort.${previewValue}`)

	const getValueFromPointer = useCallback(
		(clientX: number) => {
			const rail = railRef.current
			if (!rail || options.length < 2) {
				return previewValue
			}

			const rect = rail.getBoundingClientRect()
			const usableWidth = Math.max(1, rect.width - thumbDiameter - activeHorizontalInset * 2)
			const percentage = Math.min(
				1,
				Math.max(0, (clientX - rect.left - activeHorizontalInset - thumbRadius) / usableWidth),
			)
			return options[Math.round(percentage * (options.length - 1))] ?? previewValue
		},
		[options, previewValue],
	)

	const cancelDrag = useCallback(() => {
		if (!isDraggingRef.current) return
		isDraggingRef.current = false
		dragWasCanceledRef.current = true
		setPreviewValue(initialValueRef.current)
	}, [])

	useEffect(() => {
		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") {
				cancelDrag()
			}
		}

		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [cancelDrag])

	const commitValue = useCallback(
		(nextValue: ReasoningSliderValue, initialValue: ReasoningSliderValue) => {
			if (dragWasCanceledRef.current || nextValue === initialValue) {
				dragWasCanceledRef.current = false
				setPreviewValue(initialValue)
				return
			}

			setPreviewValue(nextValue)
			onCommit(getSettingsForValue(apiConfiguration, nextValue, isBinaryControl))
		},
		[apiConfiguration, isBinaryControl, onCommit],
	)

	const handlePointerDown = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (sliderDisabled) return

			initialValueRef.current = committedValue
			dragWasCanceledRef.current = false
			isDraggingRef.current = true
			event.currentTarget.setPointerCapture?.(event.pointerId)
			setPreviewValue(getValueFromPointer(event.clientX))
		},
		[committedValue, getValueFromPointer, sliderDisabled],
	)

	const handlePointerMove = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (isDraggingRef.current) {
				setPreviewValue(getValueFromPointer(event.clientX))
			}
		},
		[getValueFromPointer],
	)

	const handlePointerUp = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (!isDraggingRef.current) return

			isDraggingRef.current = false
			event.currentTarget.releasePointerCapture?.(event.pointerId)
			commitValue(getValueFromPointer(event.clientX), initialValueRef.current)
		},
		[commitValue, getValueFromPointer],
	)

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			if (sliderDisabled) return

			let nextIndex = previewIndex
			switch (event.key) {
				case "ArrowLeft":
				case "ArrowDown":
					nextIndex -= 1
					break
				case "ArrowRight":
				case "ArrowUp":
					nextIndex += 1
					break
				case "Home":
					nextIndex = 0
					break
				case "End":
					nextIndex = options.length - 1
					break
				default:
					return
			}

			event.preventDefault()
			const nextValue = options[Math.min(options.length - 1, Math.max(0, nextIndex))]
			if (nextValue) {
				commitValue(nextValue, committedValue)
			}
		},
		[commitValue, committedValue, options, previewIndex, sliderDisabled],
	)

	const intensityColor = getIntensityColor(previewValue, previewIndex)
	const progressWidth =
		previewValue === "disable" || previewValue === "unavailable"
			? "0%"
			: getProgressWidth(previewIndex, options.length)
	const progressPattern = getProgressPattern(previewValue)

	return (
		<div
			className="border-t border-vscode-dropdown-border bg-[linear-gradient(135deg,color-mix(in_srgb,var(--vscode-editor-background)_94%,var(--vscode-focusBorder)_6%),var(--vscode-editor-background))] px-3 py-3.5"
			data-testid="reasoning-effort-control">
			<div className="mb-3 flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="truncate text-sm font-semibold leading-5 text-vscode-foreground" title={configName}>
						{configName}
					</div>
					<div className="truncate text-xs leading-4 text-vscode-descriptionForeground" title={modelId}>
						{modelId || t("chat:apiConfigSelector.modelUnavailable")}
					</div>
				</div>
				<span
					className="mt-1.5 shrink-0 rounded-full border border-vscode-focusBorder/35 bg-vscode-focusBorder/10 px-2 py-0.5 text-[11px] font-semibold text-vscode-foreground transition-[background-color,border-color,color] duration-300"
					data-testid="reasoning-effort-value">
					{currentLabel}
				</span>
			</div>
			<div
				ref={railRef}
				role="slider"
				aria-label={t("settings:providers.reasoningEffort.label")}
				aria-orientation="horizontal"
				aria-valuemin={0}
				aria-valuemax={Math.max(0, options.length - 1)}
				aria-valuenow={previewIndex}
				aria-valuetext={currentLabel}
				tabIndex={sliderDisabled ? -1 : 0}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={cancelDrag}
				onKeyDown={handleKeyDown}
				className={cn(
					"relative h-9 w-full touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-vscode-focusBorder focus-visible:ring-offset-2 focus-visible:ring-offset-vscode-editor-background",
					sliderDisabled ? "cursor-not-allowed opacity-55" : "cursor-pointer",
				)}
				data-testid="reasoning-effort-rail">
				<div className="pointer-events-none absolute inset-0 rounded-[18px] border border-vscode-input-border bg-vscode-editor-background/65">
					<div
						data-testid="reasoning-effort-progress"
						className="relative h-full overflow-hidden rounded-full transition-[width,background-color,box-shadow] duration-300 ease-out"
						style={{
							width: progressWidth,
							backgroundImage: getProgressGradient(intensityColor, isLightTheme),
							boxShadow: getIntensityGlow(previewValue, previewIndex),
						}}>
						{progressPattern && (
							<span
								aria-hidden="true"
								className="pointer-events-none absolute inset-0 opacity-70 transition-opacity duration-300"
								data-testid="reasoning-effort-pattern"
								style={{
									backgroundImage: progressPattern.image,
									backgroundPosition: "center",
									backgroundRepeat: "repeat",
									backgroundSize: progressPattern.size,
								}}
							/>
						)}
					</div>
					{options.map((option, index) => {
						const isActive = index <= previewIndex && option !== "unavailable"
						return (
							<span
								key={option}
								data-testid={`reasoning-effort-tick-${index}`}
								className="absolute top-1/2 z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/45 transition-[background-color,border-color,box-shadow] duration-300 ease-out"
								style={{
									left: getTickLeft(index, options.length),
									backgroundColor: isActive
										? intensityColor
										: "color-mix(in srgb, var(--vscode-input-border) 42%, transparent)",
									borderColor: isActive
										? "color-mix(in srgb, var(--vscode-editor-background) 25%, white)"
										: "var(--vscode-input-border)",
									boxShadow: isActive
										? "0 0 7px color-mix(in srgb, currentColor 25%, transparent)"
										: "none",
								}}
							/>
						)
					})}
					<span
						data-testid="reasoning-effort-thumb"
						className="absolute top-1/2 z-20 size-7 -translate-y-1/2 rounded-full border-2 bg-vscode-editor-background shadow-lg transition-[left,background-color,border-color,box-shadow] duration-200 ease-out"
						style={{
							left: getThumbLeft(previewIndex, options.length),
							borderColor: "var(--vscode-editor-foreground)",
							boxShadow: `0 0 0 2px var(--vscode-editor-background), 0 0 0 4px color-mix(in srgb, ${intensityColor} 38%, transparent), ${getIntensityGlow(previewValue, previewIndex)}`,
						}}
					/>
				</div>
			</div>
		</div>
	)
}
