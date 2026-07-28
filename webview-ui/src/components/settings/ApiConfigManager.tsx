import { memo, useEffect, useRef, useState } from "react"
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core"
import {
	SortableContext,
	arrayMove,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { GripVertical, ListOrdered, TriangleAlert } from "lucide-react"

import type { ProviderSettingsEntry, OrganizationAllowList } from "@roo-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import {
	type SearchableSelectOption,
	Button,
	Input,
	Dialog,
	DialogContent,
	DialogTitle,
	StandardTooltip,
	SearchableSelect,
} from "@/components/ui"

interface ApiConfigManagerProps {
	currentApiConfigId?: string
	currentApiConfigName?: string
	listApiConfigMeta?: ProviderSettingsEntry[]
	organizationAllowList?: OrganizationAllowList
	onSelectConfig: (configId: string) => void
	onDeleteConfig: (configId: string) => void
	onRenameConfig: (configId: string, newName: string) => void
	onUpsertConfig: (configName: string) => void
	onReorderConfigs?: (ids: string[]) => void
}

interface SortableProfileItemProps {
	profile: ProviderSettingsEntry
}

const SortableProfileItem = ({ profile }: SortableProfileItemProps) => {
	const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: profile.id })

	return (
		<div
			ref={setNodeRef}
			style={{ transform: CSS.Transform.toString(transform), transition }}
			className="flex items-center gap-1.5 rounded border border-vscode-dropdown-border bg-vscode-dropdown-background px-1.5 py-1">
			<button
				type="button"
				className="flex size-6 cursor-grab items-center justify-center text-vscode-descriptionForeground hover:text-vscode-foreground active:cursor-grabbing"
				aria-label={profile.name}
				{...attributes}
				{...listeners}>
				<GripVertical className="size-4" />
			</button>
			<span className="min-w-0 flex-1 truncate text-sm">{profile.name}</span>
		</div>
	)
}

const ApiConfigManager = ({
	currentApiConfigId = "",
	currentApiConfigName = "",
	listApiConfigMeta = [],
	organizationAllowList,
	onSelectConfig,
	onDeleteConfig,
	onRenameConfig,
	onUpsertConfig,
	onReorderConfigs = () => {},
}: ApiConfigManagerProps) => {
	const { t } = useAppTranslation()

	const [isRenaming, setIsRenaming] = useState(false)
	const [isCreating, setIsCreating] = useState(false)
	const [inputValue, setInputValue] = useState("")
	const [newProfileName, setNewProfileName] = useState("")
	const [error, setError] = useState<string | null>(null)
	const [isOrdering, setIsOrdering] = useState(false)
	const [orderedProfiles, setOrderedProfiles] = useState<ProviderSettingsEntry[]>(listApiConfigMeta)
	const inputRef = useRef<any>(null)
	const newProfileInputRef = useRef<any>(null)

	// Check if a profile is valid based on the organization allow list
	const isProfileValid = (profile: ProviderSettingsEntry): boolean => {
		// If no organization allow list or allowAll is true, all profiles are valid
		if (!organizationAllowList || organizationAllowList.allowAll) {
			return true
		}

		// Check if the provider is allowed
		const provider = profile.apiProvider
		if (!provider) return true

		const providerConfig = organizationAllowList.providers[provider]
		if (!providerConfig) {
			return false
		}

		// If provider allows all models, profile is valid
		return !!providerConfig.allowAll || !!(providerConfig.models && providerConfig.models.length > 0)
	}

	const validateName = (name: string, isNewProfile: boolean): string | null => {
		const trimmed = name.trim()
		if (!trimmed) return t("settings:providers.nameEmpty")

		const nameExists = listApiConfigMeta?.some((config) => config.name.toLowerCase() === trimmed.toLowerCase())

		// For new profiles, any existing name is invalid.
		if (isNewProfile && nameExists) {
			return t("settings:providers.nameExists")
		}

		// For rename, only block if trying to rename to a different existing profile.
		if (!isNewProfile && nameExists && trimmed.toLowerCase() !== currentApiConfigName?.toLowerCase()) {
			return t("settings:providers.nameExists")
		}

		return null
	}

	const resetCreateState = () => {
		setIsCreating(false)
		setNewProfileName("")
		setError(null)
	}

	const resetRenameState = () => {
		setIsRenaming(false)
		setInputValue("")
		setError(null)
	}

	// Focus input when entering rename mode.
	useEffect(() => {
		if (isRenaming) {
			const timeoutId = setTimeout(() => inputRef.current?.focus(), 0)
			return () => clearTimeout(timeoutId)
		}
	}, [isRenaming])

	// Focus input when opening new dialog.
	useEffect(() => {
		if (isCreating) {
			const timeoutId = setTimeout(() => newProfileInputRef.current?.focus(), 0)
			return () => clearTimeout(timeoutId)
		}
	}, [isCreating])

	// Reset state when current profile changes.
	useEffect(() => {
		resetCreateState()
		resetRenameState()
	}, [currentApiConfigName])

	useEffect(() => {
		setOrderedProfiles(listApiConfigMeta)
	}, [listApiConfigMeta])

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	)

	const handleSelectConfig = (configId: string) => {
		if (!configId) return
		onSelectConfig(configId)
	}

	const handleAdd = () => {
		resetCreateState()
		setIsCreating(true)
	}

	const handleStartRename = () => {
		setIsRenaming(true)
		setInputValue(currentApiConfigName || "")
		setError(null)
	}

	const handleCancel = () => {
		resetRenameState()
	}

	const handleSave = () => {
		const trimmedValue = inputValue.trim()
		const error = validateName(trimmedValue, false)

		if (error) {
			setError(error)
			return
		}

		if (isRenaming && currentApiConfigId) {
			if (currentApiConfigName === trimmedValue) {
				resetRenameState()
				return
			}
			onRenameConfig(currentApiConfigId, trimmedValue)
		}

		resetRenameState()
	}

	const handleNewProfileSave = () => {
		const trimmedValue = newProfileName.trim()
		const error = validateName(trimmedValue, true)

		if (error) {
			setError(error)
			return
		}

		onUpsertConfig(trimmedValue)
		resetCreateState()
	}

	const handleDelete = () => {
		if (!currentApiConfigId || !listApiConfigMeta || listApiConfigMeta.length <= 1) return

		// Let the extension handle both deletion and selection.
		onDeleteConfig(currentApiConfigId)
	}

	const handleReorder = (activeId: string, overId: string | undefined) => {
		if (!overId || activeId === overId) return

		setOrderedProfiles((profiles) => {
			const oldIndex = profiles.findIndex((profile) => profile.id === activeId)
			const newIndex = profiles.findIndex((profile) => profile.id === overId)
			if (oldIndex === -1 || newIndex === -1) return profiles

			const nextProfiles = arrayMove(profiles, oldIndex, newIndex)
			onReorderConfigs(nextProfiles.map((profile) => profile.id))
			return nextProfiles
		})
	}

	const isOnlyProfile = listApiConfigMeta?.length === 1

	return (
		<div className="flex flex-col gap-1">
			<label className="block font-medium mb-1">{t("settings:providers.configProfile")}</label>

			{isRenaming ? (
				<div data-testid="rename-form">
					<div className="flex items-center gap-1">
						<VSCodeTextField
							ref={inputRef}
							value={inputValue}
							onInput={(e: unknown) => {
								const target = e as { target: { value: string } }
								setInputValue(target.target.value)
								setError(null)
							}}
							placeholder={t("settings:providers.enterNewName")}
							onKeyDown={({ key }) => {
								if (key === "Enter" && inputValue.trim()) {
									handleSave()
								} else if (key === "Escape") {
									handleCancel()
								}
							}}
							className="grow"
						/>
						<StandardTooltip content={t("settings:common.save")}>
							<Button
								variant="ghost"
								size="icon"
								disabled={!inputValue.trim()}
								onClick={handleSave}
								data-testid="save-rename-button">
								<span className="codicon codicon-check" />
							</Button>
						</StandardTooltip>
						<StandardTooltip content={t("settings:common.cancel")}>
							<Button
								variant="ghost"
								size="icon"
								onClick={handleCancel}
								data-testid="cancel-rename-button">
								<span className="codicon codicon-close" />
							</Button>
						</StandardTooltip>
					</div>
					{error && (
						<div className="text-vscode-descriptionForeground text-sm mt-1" data-testid="error-message">
							{error}
						</div>
					)}
				</div>
			) : (
				<>
					<div className="flex items-center gap-1">
						<SearchableSelect
							value={currentApiConfigId}
							onValueChange={handleSelectConfig}
							options={listApiConfigMeta.map((config) => {
								const valid = isProfileValid(config)
								return {
									value: config.id,
									label: config.name,
									disabled: !valid,
									icon: !valid ? (
										<StandardTooltip content={t("settings:validation.profileInvalid")}>
											<span>
												<TriangleAlert size={16} className="mr-2 text-vscode-errorForeground" />
											</span>
										</StandardTooltip>
									) : undefined,
								} as SearchableSelectOption
							})}
							placeholder={t("settings:common.select")}
							searchPlaceholder={t("settings:providers.searchPlaceholder")}
							emptyMessage={t("settings:providers.noMatchFound")}
							listMaxHeight="min(520px, calc(100vh - 220px))"
							nativeWheel
							className="grow"
							data-testid="select-component"
						/>
						<StandardTooltip content={t("settings:providers.sortProfiles")}>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => setIsOrdering(true)}
								data-testid="sort-profiles-button">
								<ListOrdered className="size-4" />
							</Button>
						</StandardTooltip>
						<StandardTooltip content={t("settings:providers.addProfile")}>
							<Button variant="ghost" size="icon" onClick={handleAdd} data-testid="add-profile-button">
								<span className="codicon codicon-add" />
							</Button>
						</StandardTooltip>
						{currentApiConfigName && (
							<>
								<StandardTooltip content={t("settings:providers.renameProfile")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={handleStartRename}
										data-testid="rename-profile-button">
										<span className="codicon codicon-edit" />
									</Button>
								</StandardTooltip>
								<StandardTooltip
									content={
										isOnlyProfile
											? t("settings:providers.cannotDeleteOnlyProfile")
											: t("settings:providers.deleteProfile")
									}>
									<Button
										variant="ghost"
										size="icon"
										onClick={handleDelete}
										data-testid="delete-profile-button"
										disabled={isOnlyProfile}>
										<span className="codicon codicon-trash" />
									</Button>
								</StandardTooltip>
							</>
						)}
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:providers.description")}
					</div>
				</>
			)}

			<Dialog
				open={isCreating}
				onOpenChange={(open: boolean) => {
					if (open) {
						setIsCreating(true)
						setNewProfileName("")
						setError(null)
					} else {
						resetCreateState()
					}
				}}
				aria-labelledby="new-profile-title">
				<DialogContent className="p-4 max-w-sm bg-card">
					<DialogTitle>{t("settings:providers.newProfile")}</DialogTitle>
					<Input
						ref={newProfileInputRef}
						value={newProfileName}
						onInput={(e: unknown) => {
							const target = e as { target: { value: string } }
							setNewProfileName(target.target.value)
							setError(null)
						}}
						placeholder={t("settings:providers.enterProfileName")}
						data-testid="new-profile-input"
						style={{ width: "100%" }}
						onKeyDown={(e: unknown) => {
							const event = e as { key: string }
							if (event.key === "Enter" && newProfileName.trim()) {
								handleNewProfileSave()
							} else if (event.key === "Escape") {
								resetCreateState()
							}
						}}
					/>
					{error && (
						<p className="text-vscode-errorForeground text-sm mt-2" data-testid="error-message">
							{error}
						</p>
					)}
					<div className="flex justify-end gap-2 mt-4">
						<Button variant="secondary" onClick={resetCreateState} data-testid="cancel-new-profile-button">
							{t("settings:common.cancel")}
						</Button>
						<Button
							variant="primary"
							disabled={!newProfileName.trim()}
							onClick={handleNewProfileSave}
							data-testid="create-profile-button">
							{t("settings:providers.createProfile")}
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			<Dialog open={isOrdering} onOpenChange={setIsOrdering} aria-labelledby="sort-profiles-title">
				<DialogContent
					className="flex h-[85vh] max-h-[85vh] max-w-lg flex-col bg-card p-4"
					data-testid="sort-profiles-dialog">
					<DialogTitle>{t("settings:providers.sortProfiles")}</DialogTitle>
					<p className="m-0 text-sm text-vscode-descriptionForeground">
						{t("settings:providers.sortProfilesDescription")}
					</p>
					<DndContext
						sensors={sensors}
						collisionDetection={closestCenter}
						onDragEnd={({ active, over }) =>
							handleReorder(String(active.id), over ? String(over.id) : undefined)
						}>
						<SortableContext
							items={orderedProfiles.map((profile) => profile.id)}
							strategy={verticalListSortingStrategy}>
							<div className="mt-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
								{orderedProfiles.map((profile) => (
									<SortableProfileItem key={profile.id} profile={profile} />
								))}
							</div>
						</SortableContext>
					</DndContext>
				</DialogContent>
			</Dialog>
		</div>
	)
}

export default memo(ApiConfigManager)
