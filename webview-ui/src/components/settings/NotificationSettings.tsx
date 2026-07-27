import { HTMLAttributes, useEffect } from "react"
import { FolderOpen, RefreshCw, X } from "lucide-react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { vscode } from "@src/utils/vscode"
import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { Button, Slider, StandardTooltip } from "../ui"

type NotificationSettingsProps = HTMLAttributes<HTMLDivElement> & {
	ttsEnabled?: boolean
	ttsSpeed?: number
	soundEnabled?: boolean
	soundVolume?: number
	nekoNotifierDataDirectory?: string
	setCachedStateField: SetCachedStateField<
		"ttsEnabled" | "ttsSpeed" | "soundEnabled" | "soundVolume" | "nekoNotifierDataDirectory"
	>
}

export const NotificationSettings = ({
	ttsEnabled,
	ttsSpeed,
	soundEnabled,
	soundVolume,
	nekoNotifierDataDirectory,
	setCachedStateField,
	...props
}: NotificationSettingsProps) => {
	const { t } = useAppTranslation()

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			if (event.data?.type === "nekoNotifierDirectorySelected" && typeof event.data.path === "string") {
				setCachedStateField("nekoNotifierDataDirectory", event.data.path)
			}
		}
		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [setCachedStateField])

	return (
		<div {...props}>
			<SectionHeader>{t("settings:sections.notifications")}</SectionHeader>

			<Section>
				<SearchableSetting
					settingId="notifications-tts"
					section="notifications"
					label={t("settings:notifications.tts.label")}>
					<VSCodeCheckbox
						checked={ttsEnabled}
						onChange={(e: any) => setCachedStateField("ttsEnabled", e.target.checked)}
						data-testid="tts-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.tts.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:notifications.tts.description")}
					</div>
				</SearchableSetting>

				{ttsEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<SearchableSetting
							settingId="notifications-tts-speed"
							section="notifications"
							label={t("settings:notifications.tts.speedLabel")}>
							<label className="block font-medium mb-1">
								{t("settings:notifications.tts.speedLabel")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={0.1}
									max={2.0}
									step={0.01}
									value={[ttsSpeed ?? 1.0]}
									onValueChange={([value]) => setCachedStateField("ttsSpeed", value)}
									data-testid="tts-speed-slider"
								/>
								<span className="w-10">{((ttsSpeed ?? 1.0) * 100).toFixed(0)}%</span>
							</div>
						</SearchableSetting>
					</div>
				)}

				<SearchableSetting
					settingId="notifications-sound"
					section="notifications"
					label={t("settings:notifications.sound.label")}>
					<VSCodeCheckbox
						checked={soundEnabled}
						onChange={(e: any) => setCachedStateField("soundEnabled", e.target.checked)}
						data-testid="sound-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.sound.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:notifications.sound.description")}
					</div>
				</SearchableSetting>

				{soundEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<SearchableSetting
							settingId="notifications-sound-volume"
							section="notifications"
							label={t("settings:notifications.sound.volumeLabel")}>
							<label className="block font-medium mb-1">
								{t("settings:notifications.sound.volumeLabel")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={0}
									max={1}
									step={0.01}
									value={[soundVolume ?? 0.5]}
									onValueChange={([value]) => setCachedStateField("soundVolume", value)}
									data-testid="sound-volume-slider"
								/>
								<span className="w-10">{((soundVolume ?? 0.5) * 100).toFixed(0)}%</span>
							</div>
						</SearchableSetting>
					</div>
				)}
				<SearchableSetting
					settingId="notifications-neko-notifier"
					section="notifications"
					label={t("settings:notifications.nekoNotifier.label")}>
					<label className="block font-medium mb-1">{t("settings:notifications.nekoNotifier.label")}</label>
					<div className="flex items-center gap-1 min-w-0">
						<VSCodeTextField
							value={nekoNotifierDataDirectory ?? ""}
							onInput={(event: any) =>
								setCachedStateField("nekoNotifierDataDirectory", event.target.value)
							}
							placeholder={t("settings:notifications.nekoNotifier.placeholder")}
							className="flex-1 min-w-0"
							data-testid="neko-notifier-data-directory"
						/>
						<StandardTooltip content={t("settings:notifications.nekoNotifier.browse")}>
							<Button
								variant="ghost"
								size="icon"
								type="button"
								onClick={() => vscode.postMessage({ type: "browseForNekoNotifierDataDirectory" })}
								aria-label={t("settings:notifications.nekoNotifier.browse")}>
								<FolderOpen className="size-4" />
							</Button>
						</StandardTooltip>
						<StandardTooltip content={t("settings:notifications.nekoNotifier.clear")}>
							<Button
								variant="ghost"
								size="icon"
								type="button"
								disabled={!nekoNotifierDataDirectory}
								onClick={() => setCachedStateField("nekoNotifierDataDirectory", "")}
								aria-label={t("settings:notifications.nekoNotifier.clear")}>
								<X className="size-4" />
							</Button>
						</StandardTooltip>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:notifications.nekoNotifier.description")}
					</div>
					<Button
						variant="outline"
						type="button"
						className="mt-3"
						disabled={!nekoNotifierDataDirectory?.trim()}
						onClick={() => vscode.postMessage({ type: "reloadNekoNotifier" })}
						data-testid="reload-neko-notifier-button">
						<RefreshCw className="size-4" />
						{t("settings:notifications.nekoNotifier.reload")}
					</Button>
				</SearchableSetting>
			</Section>
		</div>
	)
}
