import { HTMLAttributes, useMemo } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { telemetryClient } from "@/utils/TelemetryClient"
import {
	DEFAULT_AUTO_CLOSE_ZOO_OPENED_FILES,
	DEFAULT_AUTO_CLOSE_ZOO_OPENED_FILES_AFTER_USER_EDITED,
	DEFAULT_AUTO_CLOSE_ZOO_OPENED_NEW_FILES,
} from "@roo-code/types"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { Slider, Button } from "../ui"
import { ExtensionStateContextType } from "@/context/ExtensionStateContext"

export const CHAT_FONT_SIZE_MIN = 8
export const CHAT_FONT_SIZE_MAX = 32
export const CHAT_FONT_SIZE_DEFAULT = 13

interface UISettingsProps extends HTMLAttributes<HTMLDivElement> {
	reasoningBlockCollapsed: boolean
	enterBehavior: "send" | "newline"
	chatFontSize?: number
	autoCloseZooOpenedFiles?: boolean
	autoCloseZooOpenedFilesAfterUserEdited?: boolean
	autoCloseZooOpenedNewFiles?: boolean
	backgroundImageEnabled?: boolean
	backgroundImageUrl?: string | null
	backgroundImageSize?: "contain" | "cover" | "auto"
	backgroundImagePosition?: "left" | "center" | "right"
	backgroundImageOffset?: number
	backgroundImageOpacity?: number
	dedicatedIdeLayoutEnabled?: boolean
	userAvatarUrl?: string | null
	isUserAvatarRemovalPending?: boolean
	userAvatarSelectionMessage?: string
	isSelectingUserAvatar?: boolean
	onSelectUserAvatar?: () => void
	onClearUserAvatar?: () => void
	setCachedStateField: SetCachedStateField<keyof ExtensionStateContextType>
}

export const UISettings = ({
	reasoningBlockCollapsed,
	enterBehavior,
	chatFontSize,
	autoCloseZooOpenedFiles,
	autoCloseZooOpenedFilesAfterUserEdited,
	autoCloseZooOpenedNewFiles,
	backgroundImageEnabled = true,
	backgroundImageUrl = null,
	backgroundImageSize = "contain",
	backgroundImagePosition = "right",
	backgroundImageOffset = 0,
	backgroundImageOpacity = 0.25,
	dedicatedIdeLayoutEnabled = false,
	userAvatarUrl,
	isUserAvatarRemovalPending = false,
	userAvatarSelectionMessage,
	isSelectingUserAvatar = false,
	onSelectUserAvatar = () => {},
	onClearUserAvatar = () => {},
	setCachedStateField,
	...props
}: UISettingsProps) => {
	const { t } = useAppTranslation()

	// Detect platform for dynamic modifier key display
	const primaryMod = useMemo(() => {
		const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0
		return isMac ? "⌘" : "Ctrl"
	}, [])

	const handleReasoningBlockCollapsedChange = (value: boolean) => {
		setCachedStateField("reasoningBlockCollapsed", value)

		// Track telemetry event
		telemetryClient.capture("ui_settings_collapse_thinking_changed", {
			enabled: value,
		})
	}

	const handleEnterBehaviorChange = (requireCtrlEnter: boolean) => {
		const newBehavior = requireCtrlEnter ? "newline" : "send"
		setCachedStateField("enterBehavior", newBehavior)

		// Track telemetry event
		telemetryClient.capture("ui_settings_enter_behavior_changed", {
			behavior: newBehavior,
		})
	}

	const handleChatFontSizeChange = (value: number) => {
		setCachedStateField("chatFontSize", value)

		// Track telemetry event
		telemetryClient.capture("ui_settings_chat_font_size_changed", {
			value,
		})
	}

	const handleChatFontSizeReset = () => {
		setCachedStateField("chatFontSize", undefined)

		// Track telemetry event
		telemetryClient.capture("ui_settings_chat_font_size_reset")
	}

	const handleBackgroundImageEnabledChange = (value: boolean) => {
		setCachedStateField("backgroundImageEnabled", value)
		telemetryClient.capture("ui_settings_background_image_enabled_changed", { enabled: value })
	}

	const handleBackgroundImageUrlChange = (value: string) => {
		setCachedStateField("backgroundImageUrl", value || null)
		telemetryClient.capture("ui_settings_background_image_url_changed")
	}

	const handleBackgroundImageSizeChange = (value: string) => {
		setCachedStateField("backgroundImageSize", value as "contain" | "cover" | "auto")
		telemetryClient.capture("ui_settings_background_image_size_changed", { size: value })
	}

	const handleBackgroundImagePositionChange = (value: string) => {
		setCachedStateField("backgroundImagePosition", value as "left" | "center" | "right")
		telemetryClient.capture("ui_settings_background_image_position_changed", { position: value })
	}

	const handleBackgroundImageOffsetChange = (value: number) => {
		setCachedStateField("backgroundImageOffset", value)
		telemetryClient.capture("ui_settings_background_image_offset_changed", { offset: value })
	}

	const handleBackgroundImageOpacityChange = (value: number) => {
		setCachedStateField("backgroundImageOpacity", value)
		telemetryClient.capture("ui_settings_background_image_opacity_changed", { opacity: value })
	}

	return (
		<div {...props}>
			<SectionHeader>{t("settings:sections.ui")}</SectionHeader>

			<Section>
				<div className="space-y-6">
					{/* Collapse Thinking Messages Setting */}
					<SearchableSetting
						settingId="ui-collapse-thinking"
						section="ui"
						label={t("settings:ui.collapseThinking.label")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={reasoningBlockCollapsed}
								onChange={(e: any) => handleReasoningBlockCollapsedChange(e.target.checked)}
								data-testid="collapse-thinking-checkbox">
								<span className="font-medium">{t("settings:ui.collapseThinking.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.collapseThinking.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Enter Key Behavior Setting */}
					<SearchableSetting
						settingId="ui-enter-behavior"
						section="ui"
						label={t("settings:ui.requireCtrlEnterToSend.label", { primaryMod })}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={enterBehavior === "newline"}
								onChange={(e: any) => handleEnterBehaviorChange(e.target.checked)}
								data-testid="enter-behavior-checkbox">
								<span className="font-medium">
									{t("settings:ui.requireCtrlEnterToSend.label", { primaryMod })}
								</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.requireCtrlEnterToSend.description", { primaryMod })}
							</div>
						</div>
					</SearchableSetting>

					{/* Chat Font Size Setting */}
					<SearchableSetting
						settingId="ui-chat-font-size"
						section="ui"
						label={t("settings:ui.chatFontSize.label")}>
						<div className="flex flex-col gap-1">
							<label className="block font-medium mb-1">{t("settings:ui.chatFontSize.label")}</label>
							<div className="flex items-center gap-2">
								<Slider
									min={CHAT_FONT_SIZE_MIN}
									max={CHAT_FONT_SIZE_MAX}
									step={1}
									value={[chatFontSize ?? CHAT_FONT_SIZE_DEFAULT]}
									onValueChange={([value]) => handleChatFontSizeChange(value)}
									data-testid="chat-font-size-slider"
								/>
								<span className="w-12 text-right">{chatFontSize ?? CHAT_FONT_SIZE_DEFAULT}px</span>
								<Button
									variant="secondary"
									size="sm"
									disabled={chatFontSize === undefined}
									onClick={handleChatFontSizeReset}
									data-testid="chat-font-size-reset">
									{t("settings:ui.chatFontSize.reset")}
								</Button>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:ui.chatFontSize.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Auto-close Zoo opened files */}
					<SearchableSetting
						settingId="ui-auto-close-zoo-opened-files"
						section="ui"
						label={t("settings:ui.autoCloseZooOpenedFiles.label")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={autoCloseZooOpenedFiles ?? DEFAULT_AUTO_CLOSE_ZOO_OPENED_FILES}
								onChange={(e: any) => setCachedStateField("autoCloseZooOpenedFiles", e.target.checked)}
								data-testid="auto-close-zoo-opened-files-checkbox">
								<span className="font-medium">{t("settings:ui.autoCloseZooOpenedFiles.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.autoCloseZooOpenedFiles.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Auto-close Zoo opened files after user interaction */}
					<SearchableSetting
						settingId="ui-auto-close-zoo-opened-files-after-user-edited"
						section="ui"
						label={t("settings:ui.autoCloseZooOpenedFilesAfterUserEdited.label")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={
									autoCloseZooOpenedFilesAfterUserEdited ??
									DEFAULT_AUTO_CLOSE_ZOO_OPENED_FILES_AFTER_USER_EDITED
								}
								onChange={(e: any) =>
									setCachedStateField("autoCloseZooOpenedFilesAfterUserEdited", e.target.checked)
								}
								data-testid="auto-close-zoo-opened-files-after-user-edited-checkbox">
								<span className="font-medium">
									{t("settings:ui.autoCloseZooOpenedFilesAfterUserEdited.label")}
								</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.autoCloseZooOpenedFilesAfterUserEdited.description")}
							</div>
						</div>
					</SearchableSetting>

					{/* Auto-close Zoo opened new files */}
					<SearchableSetting
						settingId="ui-auto-close-zoo-opened-new-files"
						section="ui"
						label={t("settings:ui.autoCloseZooOpenedNewFiles.label")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={autoCloseZooOpenedNewFiles ?? DEFAULT_AUTO_CLOSE_ZOO_OPENED_NEW_FILES}
								onChange={(e: any) =>
									setCachedStateField("autoCloseZooOpenedNewFiles", e.target.checked)
								}
								data-testid="auto-close-zoo-opened-new-files-checkbox">
								<span className="font-medium">{t("settings:ui.autoCloseZooOpenedNewFiles.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.autoCloseZooOpenedNewFiles.description")}
							</div>
						</div>
					</SearchableSetting>

					<SearchableSetting
						settingId="ui-dedicated-ide-layout"
						section="ui"
						label={t("settings:ui.dedicatedIdeLayout.label")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={dedicatedIdeLayoutEnabled}
								onChange={(e: any) =>
									setCachedStateField("dedicatedIdeLayoutEnabled", e.target.checked)
								}
								data-testid="dedicated-ide-layout-checkbox">
								<span className="font-medium">{t("settings:ui.dedicatedIdeLayout.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.dedicatedIdeLayout.description")}
							</div>
						</div>
					</SearchableSetting>

					{dedicatedIdeLayoutEnabled ? (
						<SearchableSetting
							settingId="ui-user-avatar"
							section="ui"
							label={t("settings:ui.userAvatar.label")}>
							<div className="flex flex-col gap-2">
								<div>
									<div className="font-medium">{t("settings:ui.userAvatar.label")}</div>
									<div className="text-vscode-descriptionForeground text-sm mt-1">
										{t("settings:ui.userAvatar.description")}
									</div>
								</div>
								<div className="flex flex-col items-start gap-2">
									<div className="flex items-center gap-3">
										{userAvatarUrl ? (
											<img
												src={userAvatarUrl}
												alt=""
												className="size-10 rounded-full object-cover border border-vscode-editorWidget-border"
											/>
										) : null}
										<Button
											variant="secondary"
											size="sm"
											disabled={isSelectingUserAvatar}
											onClick={onSelectUserAvatar}
											data-testid="select-user-avatar-button">
											{isSelectingUserAvatar
												? t("settings:ui.userAvatar.selecting")
												: t(
														userAvatarUrl
															? "settings:ui.userAvatar.change"
															: "settings:ui.userAvatar.choose",
													)}
										</Button>
										{userAvatarUrl && !isUserAvatarRemovalPending ? (
											<Button
												variant="secondary"
												size="sm"
												disabled={isSelectingUserAvatar}
												onClick={onClearUserAvatar}
												data-testid="clear-user-avatar-button">
												{t("settings:ui.userAvatar.clear")}
											</Button>
										) : null}
									</div>
									{userAvatarSelectionMessage ? (
										<p
											className="m-0 text-sm text-vscode-descriptionForeground"
											data-testid="user-avatar-selection-status">
											{userAvatarSelectionMessage}
										</p>
									) : null}
								</div>
							</div>
						</SearchableSetting>
					) : null}

					{/* --- Background Image Settings --- */}
					<SectionHeader className="mt-4">{t("settings:ui.backgroundImage.sectionTitle")}</SectionHeader>

					<SearchableSetting
						settingId="ui-background-image-enabled"
						section="ui"
						label={t("settings:ui.backgroundImage.enabled.label")}>
						<div className="flex flex-col gap-1">
							<VSCodeCheckbox
								checked={backgroundImageEnabled}
								onChange={(e: any) => handleBackgroundImageEnabledChange(e.target.checked)}
								data-testid="background-image-enabled-checkbox">
								<span className="font-medium">{t("settings:ui.backgroundImage.enabled.label")}</span>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm ml-5 mt-1">
								{t("settings:ui.backgroundImage.enabled.description")}
							</div>
						</div>
					</SearchableSetting>

					<SearchableSetting
						settingId="ui-background-image-url"
						section="ui"
						label={t("settings:ui.backgroundImage.url.label")}>
						<div className="flex flex-col gap-1">
							<label className="block font-medium mb-1">
								{t("settings:ui.backgroundImage.url.label")}
							</label>
							<VSCodeTextField
								value={backgroundImageUrl ?? ""}
								onInput={(e: any) => handleBackgroundImageUrlChange(e.target.value)}
								placeholder={t("settings:ui.backgroundImage.url.placeholder")}
								data-testid="background-image-url-input"
								disabled={!backgroundImageEnabled}
								className="w-full"></VSCodeTextField>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:ui.backgroundImage.url.description")}
							</div>
						</div>
					</SearchableSetting>

					<SearchableSetting
						settingId="ui-background-image-size"
						section="ui"
						label={t("settings:ui.backgroundImage.size.label")}>
						<div className="flex flex-col gap-1">
							<label className="block font-medium mb-1">
								{t("settings:ui.backgroundImage.size.label")}
							</label>
							<VSCodeDropdown
								value={backgroundImageSize}
								onChange={(e: any) => handleBackgroundImageSizeChange(e.target.value)}
								data-testid="background-image-size-dropdown"
								disabled={!backgroundImageEnabled}>
								<VSCodeOption value="contain">
									{t("settings:ui.backgroundImage.size.options.contain")}
								</VSCodeOption>
								<VSCodeOption value="cover">
									{t("settings:ui.backgroundImage.size.options.cover")}
								</VSCodeOption>
								<VSCodeOption value="auto">
									{t("settings:ui.backgroundImage.size.options.auto")}
								</VSCodeOption>
							</VSCodeDropdown>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:ui.backgroundImage.size.description")}
							</div>
						</div>
					</SearchableSetting>

					<SearchableSetting
						settingId="ui-background-image-position"
						section="ui"
						label={t("settings:ui.backgroundImage.position.label")}>
						<div className="flex flex-col gap-1">
							<label className="block font-medium mb-1">
								{t("settings:ui.backgroundImage.position.label")}
							</label>
							<VSCodeDropdown
								value={backgroundImagePosition}
								onChange={(e: any) => handleBackgroundImagePositionChange(e.target.value)}
								data-testid="background-image-position-dropdown"
								disabled={!backgroundImageEnabled}>
								<VSCodeOption value="left">
									{t("settings:ui.backgroundImage.position.options.left")}
								</VSCodeOption>
								<VSCodeOption value="center">
									{t("settings:ui.backgroundImage.position.options.center")}
								</VSCodeOption>
								<VSCodeOption value="right">
									{t("settings:ui.backgroundImage.position.options.right")}
								</VSCodeOption>
							</VSCodeDropdown>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:ui.backgroundImage.position.description")}
							</div>
						</div>
					</SearchableSetting>

					<SearchableSetting
						settingId="ui-background-image-offset"
						section="ui"
						label={t("settings:ui.backgroundImage.offset.label")}>
						<div className="flex flex-col gap-1">
							<label className="block font-medium mb-1">
								{t("settings:ui.backgroundImage.offset.label")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={-100}
									max={100}
									step={1}
									value={[backgroundImageOffset]}
									onValueChange={([value]) => handleBackgroundImageOffsetChange(value)}
									data-testid="background-image-offset-slider"
									disabled={!backgroundImageEnabled}
								/>
								<span className="w-14 text-right">{backgroundImageOffset}%</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:ui.backgroundImage.offset.description")}
							</div>
						</div>
					</SearchableSetting>

					<SearchableSetting
						settingId="ui-background-image-opacity"
						section="ui"
						label={t("settings:ui.backgroundImage.opacity.label")}>
						<div className="flex flex-col gap-1">
							<label className="block font-medium mb-1">
								{t("settings:ui.backgroundImage.opacity.label")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={0}
									max={1}
									step={0.05}
									value={[backgroundImageOpacity]}
									onValueChange={([value]) => handleBackgroundImageOpacityChange(value)}
									data-testid="background-image-opacity-slider"
									disabled={!backgroundImageEnabled}
								/>
								<span className="w-12 text-right">{backgroundImageOpacity.toFixed(2)}</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:ui.backgroundImage.opacity.description")}
							</div>
						</div>
					</SearchableSetting>
				</div>
			</Section>
		</div>
	)
}
