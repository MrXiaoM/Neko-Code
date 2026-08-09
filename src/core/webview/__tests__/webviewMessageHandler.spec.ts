// npx vitest core/webview/__tests__/webviewMessageHandler.spec.ts

import type { Mock } from "vitest"

// Mock dependencies - must come before imports
vi.mock("../../../api/providers/fetchers/modelCache")
vi.mock("../../../services/zoo-code-auth", () => ({
	disconnectZooCode: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../../../api/providers/fetchers/lmstudio", () => ({
	getLMStudioModels: vi.fn(),
}))

vi.mock("../../../integrations/openai-codex/oauth", () => ({
	openAiCodexOAuthManager: {
		getAccessToken: vi.fn(),
		getAccountId: vi.fn(),
	},
}))

vi.mock("../../../integrations/openai-codex/rate-limits", () => ({
	fetchOpenAiCodexRateLimitInfo: vi.fn(),
}))

vi.mock("../../../services/command/commands", () => ({
	getCommands: vi.fn(),
}))

vi.mock("../../../services/destructive-command-guard", () => ({
	ensureDcgInstalled: vi.fn(),
}))

vi.mock("@anthropic-ai/vertex-sdk", () => ({
	AnthropicVertex: vi.fn(),
}))

vi.mock("google-auth-library", () => ({
	GoogleAuth: vi.fn(),
}))

vi.mock("ollama", () => ({
	Ollama: vi.fn(),
}))

// Mock the diagnosticsHandler module
vi.mock("../diagnosticsHandler", () => ({
	generateErrorDiagnostics: vi.fn().mockResolvedValue({ success: true, filePath: "/tmp/diagnostics.json" }),
}))

vi.mock("../../../integrations/notifications/approvalNotification", () => ({
	notifyApprovalIfWindowUnfocused: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../../integrations/notifications/nekoNotifierClient", () => ({
	nekoNotifierClient: {
		configure: vi.fn().mockResolvedValue(true),
		isActive: true,
	},
}))

vi.mock("../rulesMessageHandler", () => ({
	handleRequestRules: vi.fn(),
	handleCreateRule: vi.fn(),
	handleDeleteRule: vi.fn(),
	handleOpenRuleFile: vi.fn(),
	handleOpenRulesDirectory: vi.fn(),
}))

import type { ModelRecord } from "@roo-code/types"

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"
import { flushModels, getModels } from "../../../api/providers/fetchers/modelCache"
import { getLMStudioModels } from "../../../api/providers/fetchers/lmstudio"
import { getCommands } from "../../../services/command/commands"
import { notifyApprovalIfWindowUnfocused } from "../../../integrations/notifications/approvalNotification"
import { ensureDcgInstalled } from "../../../services/destructive-command-guard"
import {
	handleCreateRule,
	handleDeleteRule,
	handleOpenRuleFile,
	handleOpenRulesDirectory,
	handleRequestRules,
} from "../rulesMessageHandler"
const { openAiCodexOAuthManager } = await import("../../../integrations/openai-codex/oauth")
const { fetchOpenAiCodexRateLimitInfo } = await import("../../../integrations/openai-codex/rate-limits")

const mockGetModels = getModels as Mock<typeof getModels>
const mockFlushModels = flushModels as Mock<typeof flushModels>
const mockGetLMStudioModels = getLMStudioModels as Mock<typeof getLMStudioModels>
const mockGetCommands = vi.mocked(getCommands)
const mockGetAccessToken = vi.mocked(openAiCodexOAuthManager.getAccessToken)
const mockGetAccountId = vi.mocked(openAiCodexOAuthManager.getAccountId)
const mockFetchOpenAiCodexRateLimitInfo = vi.mocked(fetchOpenAiCodexRateLimitInfo)

// Mock ClineProvider
const mockClineProvider = {
	getState: vi.fn(),
	postMessageToWebview: vi.fn(),
	postMessageToSpecificWebview: vi.fn(),
	customModesManager: {
		getCustomModes: vi.fn(),
		deleteCustomMode: vi.fn(),
	},
	context: {
		extensionPath: "/mock/extension/path",
		globalStorageUri: { fsPath: "/mock/global/storage" },
		logUri: { fsPath: "/mock/extension/logs" },
		extension: { id: "zoo-code.zoo-code" },
	},
	contextProxy: {
		context: {
			extensionPath: "/mock/extension/path",
			globalStorageUri: { fsPath: "/mock/global/storage" },
		},
		setValue: vi.fn(),
		getValue: vi.fn(),
		getGlobalState: vi.fn(),
	},
	log: vi.fn(),
	postStateToWebview: vi.fn(),
	selectUserAvatar: vi.fn(),
	commitUserAvatar: vi.fn(),
	discardUserAvatar: vi.fn(),
	openDedicatedIdeLayout: vi.fn(),
	disableDedicatedIdeLayout: vi.fn(),
	openSettingsInDedicatedEditor: vi.fn(),
	requestComposerPrimaryButtonClick: vi.fn(),
	requestComposerSecondaryButtonClick: vi.fn(),
	requestComposerDraftAppend: vi.fn(),
	handleModeSwitch: vi.fn(),
	activateProviderProfile: vi.fn(),
	getCurrentTask: vi.fn(),
	getTaskWithId: vi.fn(),
	createTaskWithHistoryItem: vi.fn(),
	getSkillsManager: vi.fn(),
	cwd: "/mock/workspace",
} as unknown as ClineProvider

import { t } from "../../../i18n"

vi.mock("vscode", () => {
	const showInformationMessage = vi.fn()
	const showErrorMessage = vi.fn()
	const showQuickPick = vi.fn()
	const openTextDocument = vi.fn().mockResolvedValue({})
	const showTextDocument = vi.fn().mockResolvedValue(undefined)

	return {
		env: {
			openExternal: vi.fn(),
		},
		Uri: {
			parse: vi.fn((url: string) => url),
		},
		window: {
			showInformationMessage,
			showErrorMessage,
			showQuickPick,
			showTextDocument,
		},
		workspace: {
			workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
			openTextDocument,
			getConfiguration: vi.fn(() => ({ get: vi.fn() })),
		},
		commands: {
			executeCommand: vi.fn().mockResolvedValue(undefined),
		},
	}
})

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string, args?: Record<string, unknown>) => {
		// For the delete confirmation with rules, we need to return the interpolated string
		if (key === "common:confirmation.delete_custom_mode_with_rules" && args) {
			return `Are you sure you want to delete this ${args.scope} mode?\n\nThis will also delete the associated rules folder at:\n${args.rulesFolderPath}`
		}
		// Return the translated value for "Yes"
		if (key === "common:answers.yes") {
			return "Yes"
		}
		// Return the translated value for "Cancel"
		if (key === "common:answers.cancel") {
			return "Cancel"
		}
		return key
	}),
}))

vi.mock("fs/promises", () => {
	const mockRm = vi.fn().mockResolvedValue(undefined)
	const mockMkdir = vi.fn().mockResolvedValue(undefined)
	const mockReadFile = vi.fn().mockResolvedValue("[]")
	const mockWriteFile = vi.fn().mockResolvedValue(undefined)
	const mockAppendFile = vi.fn().mockResolvedValue(undefined)

	return {
		default: {
			rm: mockRm,
			mkdir: mockMkdir,
			readFile: mockReadFile,
			writeFile: mockWriteFile,
			appendFile: mockAppendFile,
		},
		rm: mockRm,
		mkdir: mockMkdir,
		readFile: mockReadFile,
		writeFile: mockWriteFile,
		appendFile: mockAppendFile,
	}
})

import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as fsUtils from "../../../utils/fs"
import { getWorkspacePath } from "../../../utils/path"
import { ensureSettingsDirectoryExists } from "../../../utils/globalContext"
import { generateErrorDiagnostics } from "../diagnosticsHandler"
import type { ModeConfig } from "@roo-code/types"

vi.mock("../../../utils/fs")
vi.mock("../../../utils/path")
vi.mock("../../../utils/globalContext")

vi.mock("../../mentions/resolveImageMentions", () => ({
	resolveImageMentions: vi.fn(async ({ text, images }: { text: string; images?: string[] }) => ({
		text,
		images: [...(images ?? []), "data:image/png;base64,from-mention"],
	})),
}))

import { resolveImageMentions } from "../../mentions/resolveImageMentions"
import { Terminal } from "../../../integrations/terminal/Terminal"
import { TerminalRegistry } from "../../../integrations/terminal/TerminalRegistry"

describe("webviewMessageHandler - requestLmStudioModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockGetLMStudioModels.mockReset()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				lmStudioModelId: "model-1",
				lmStudioBaseUrl: "http://localhost:1234",
			},
		})
	})

	it("successfully fetches models from LMStudio", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
			"model-2": {
				maxTokens: 8192,
				contextWindow: 16384,
				supportsPromptCache: false,
				description: "Test model 2",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestLmStudioModels",
		})

		expect(mockGetModels).toHaveBeenCalledWith({ provider: "lmstudio", baseUrl: "http://localhost:1234" })

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "lmStudioModels",
			lmStudioModels: mockModels,
		})
	})

	it("prefers the request payload base URL over persisted settings", async () => {
		mockGetLMStudioModels.mockResolvedValue({})

		await webviewMessageHandler(mockClineProvider, {
			type: "requestLmStudioModels",
			values: { baseUrl: "http://127.0.0.1:4321" },
		})

		expect(mockGetLMStudioModels).toHaveBeenCalledWith("http://127.0.0.1:4321")
		expect(mockGetModels).not.toHaveBeenCalled()
	})

	it("treats an empty-string base URL as an explicit preview request", async () => {
		mockGetLMStudioModels.mockResolvedValue({})

		await webviewMessageHandler(mockClineProvider, {
			type: "requestLmStudioModels",
			values: { baseUrl: "" },
		})

		expect(mockGetLMStudioModels).toHaveBeenCalledWith("")
		expect(mockGetModels).not.toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - image mentions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			maxImageFileSize: 5,
			maxTotalImageSize: 20,
		})
	})

	it("should resolve image mentions for askResponse payloads", async () => {
		const mockHandleWebviewAskResponse = vi.fn()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			rooIgnoreController: undefined,
			handleWebviewAskResponse: mockHandleWebviewAskResponse,
		} as unknown as ReturnType<ClineProvider["getCurrentTask"]>)

		await webviewMessageHandler(mockClineProvider, {
			type: "askResponse",
			askResponse: "messageResponse",
			text: "See @/img.png",
			images: [],
		})

		expect(vi.mocked(resolveImageMentions)).toHaveBeenCalled()
		expect(mockHandleWebviewAskResponse).toHaveBeenCalledWith("messageResponse", "See @/img.png", [
			"data:image/png;base64,from-mention",
		])
	})
})

describe("webviewMessageHandler - requestOllamaModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockFlushModels.mockReset()
		mockFlushModels.mockResolvedValue(undefined)
		mockGetModels.mockReset()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				ollamaModelId: "model-1",
				ollamaBaseUrl: "http://localhost:1234",
			},
		})
	})

	it("successfully fetches models from Ollama", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
			"model-2": {
				maxTokens: 8192,
				contextWindow: 16384,
				supportsPromptCache: false,
				description: "Test model 2",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestOllamaModels",
		})

		expect(mockGetModels).toHaveBeenCalledWith({ provider: "ollama", baseUrl: "http://localhost:1234" })

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "ollamaModels",
			ollamaModels: mockModels,
		})
	})

	it("posts empty models response when no models are found", async () => {
		mockGetModels.mockResolvedValue({})

		await webviewMessageHandler(mockClineProvider, {
			type: "requestOllamaModels",
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "ollamaModels",
			ollamaModels: {},
		})
	})

	it("posts empty models response with error message and logs to output on fetch failure", async () => {
		mockGetModels.mockRejectedValue(new Error("Connection refused"))

		await webviewMessageHandler(mockClineProvider, {
			type: "requestOllamaModels",
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "ollamaModels",
			ollamaModels: {},
			error: "Connection refused",
		})

		expect(mockClineProvider.log).toHaveBeenCalledWith(
			"[requestOllamaModels] Failed to read models for http://localhost:1234: Connection refused",
		)
	})

	it("distinguishes a model cache refresh failure from a model read failure", async () => {
		mockFlushModels.mockRejectedValue(new Error("Cache write failed"))

		await webviewMessageHandler(mockClineProvider, {
			type: "requestOllamaModels",
			values: { baseUrl: "https://ollama.example.com" },
		})

		expect(mockGetModels).not.toHaveBeenCalled()
		expect(mockClineProvider.log).toHaveBeenCalledWith(
			"[requestOllamaModels] Failed to refresh model cache for https://ollama.example.com: Cache write failed",
		)
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "ollamaModels",
			ollamaModels: {},
			error: "Cache write failed",
		})
	})

	it("uses baseUrl from message values over saved state", async () => {
		const mockModels: ModelRecord = {
			"remote-model": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Remote model",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestOllamaModels",
			values: {
				baseUrl: "https://ollama.example.com",
				apiKey: "secret-key",
			},
		})

		// Should use the URL from message values, not the saved state
		expect(mockFlushModels).toHaveBeenCalledWith(
			{
				provider: "ollama",
				baseUrl: "https://ollama.example.com",
				apiKey: "secret-key",
			},
			true,
		)
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "ollama",
			baseUrl: "https://ollama.example.com",
			apiKey: "secret-key",
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "ollamaModels",
			ollamaModels: mockModels,
		})
	})
})

describe("webviewMessageHandler - requestRouterModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				litellmApiKey: "litellm-key",
				litellmBaseUrl: "http://localhost:4000",
			},
		})
	})

	it("successfully fetches models from all providers", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
			"model-2": {
				maxTokens: 8192,
				contextWindow: 16384,
				supportsPromptCache: false,
				description: "Test model 2",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
		})

		// Verify getModels was called for each provider
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "openrouter" })
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "requesty", apiKey: "requesty-key" })
		expect(mockGetModels).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "unbound",
			}),
		)
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "vercel-ai-gateway" })
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "litellm-key",
			baseUrl: "http://localhost:4000",
		})
		// Opencode Go's /models endpoint is public, so it is fetched like the other no-auth routers.
		expect(mockGetModels).toHaveBeenCalledWith(expect.objectContaining({ provider: "opencode-go" }))
		// Kenari's /models endpoint is public, so it is fetched like the other no-auth routers.
		expect(mockGetModels).toHaveBeenCalledWith(expect.objectContaining({ provider: "kenari" }))

		// Verify response was sent
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				openrouter: mockModels,
				requesty: mockModels,
				unbound: mockModels,
				"vercel-ai-gateway": mockModels,
				"zoo-gateway": mockModels,
				litellm: mockModels,
				ollama: {},
				lmstudio: {},
				poe: {},
				deepseek: {},
				moonshot: {},
				"opencode-go": mockModels,
				kenari: mockModels,
				"kimi-code": {},
			},
			values: undefined,
		})
	})

	it("fetches Opencode Go models without an API key (public /models endpoint, regression for empty picker)", async () => {
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				// Deliberately no opencodeGoApiKey — the endpoint is public.
			},
		})

		const mockModels: ModelRecord = {
			"glm-5.1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "GLM 5.1",
			},
		}
		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, { type: "requestRouterModels" })

		// Must be fetched despite no configured key, forwarding apiKey: undefined.
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "opencode-go", apiKey: undefined })

		const routerModelsCall = vi
			.mocked(mockClineProvider.postMessageToWebview)
			.mock.calls.find(([message]) => message.type === "routerModels")
		expect(routerModelsCall).toBeDefined()
		if (!routerModelsCall) {
			throw new Error("Expected a routerModels response")
		}
		const routerModels = routerModelsCall[0].routerModels
		expect(routerModels).toBeDefined()
		if (!routerModels) {
			throw new Error("Expected routerModels data in the response")
		}
		expect(routerModels["opencode-go"]).toEqual(mockModels)
	})

	it("flushes and fetches Opencode Go models when an explicit API key is supplied", async () => {
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {},
		})
		mockGetModels.mockResolvedValue({
			"opencode/model": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Opencode model",
			},
		})

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
			values: {
				provider: "opencode-go",
				opencodeGoApiKey: "fresh-key",
			},
		})

		expect(mockFlushModels).toHaveBeenCalledWith({ provider: "opencode-go", apiKey: "fresh-key" }, true)
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "opencode-go", apiKey: "fresh-key" })
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				"opencode-go": {
					"opencode/model": expect.objectContaining({ description: "Opencode model" }),
				},
			},
			values: { provider: "opencode-go" },
		})
	})

	it("flushes and fetches Kenari models when an explicit API key is supplied", async () => {
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {},
		})
		mockGetModels.mockResolvedValue({
			"glm-5-2": {
				maxTokens: 32768,
				contextWindow: 1048576,
				supportsPromptCache: false,
				description: "Kenari model",
			},
		})

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
			values: {
				provider: "kenari",
				kenariApiKey: "fresh-kenari-key",
			},
		})

		expect(mockFlushModels).toHaveBeenCalledWith({ provider: "kenari", apiKey: "fresh-kenari-key" }, true)
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "kenari", apiKey: "fresh-kenari-key" })
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				kenari: {
					"glm-5-2": expect.objectContaining({ description: "Kenari model" }),
				},
			},
			values: { provider: "kenari" },
		})
	})

	it("handles LiteLLM models with values from message when config is missing", async () => {
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				// Missing litellm config
			},
		})

		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
			values: {
				litellmApiKey: "message-litellm-key",
				litellmBaseUrl: "http://message-url:4000",
			},
		})

		// Verify LiteLLM was called with values from message
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "message-litellm-key",
			baseUrl: "http://message-url:4000",
		})
	})

	it("skips LiteLLM when both config and message values are missing", async () => {
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				// Missing litellm config
			},
		})

		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
			// No values provided
		})

		// Verify LiteLLM was NOT called
		expect(mockGetModels).not.toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "litellm",
			}),
		)

		// Verify response includes empty object for LiteLLM
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				openrouter: mockModels,
				requesty: mockModels,
				unbound: mockModels,
				"vercel-ai-gateway": mockModels,
				"zoo-gateway": mockModels,
				litellm: {},
				ollama: {},
				lmstudio: {},
				poe: {},
				deepseek: {},
				moonshot: {},
				"opencode-go": mockModels,
				kenari: mockModels,
				"kimi-code": {},
			},
			values: undefined,
		})
	})

	it("handles individual provider failures gracefully", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
		}

		// Mock some providers to succeed and others to fail
		mockGetModels
			.mockResolvedValueOnce(mockModels) // openrouter
			.mockRejectedValueOnce(new Error("Requesty API error")) // requesty
			.mockResolvedValueOnce(mockModels) // unbound
			.mockResolvedValueOnce(mockModels) // vercel-ai-gateway
			.mockResolvedValueOnce(mockModels) // zoo-gateway
			.mockRejectedValueOnce(new Error("LiteLLM connection failed")) // litellm
			.mockResolvedValueOnce(mockModels) // opencode-go

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
		})

		// Verify error messages were sent for failed providers (these come first)
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Requesty API error",
			values: { provider: "requesty" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "LiteLLM connection failed",
			values: { provider: "litellm" },
		})

		// Verify final routerModels response includes successful providers and empty objects for failed ones
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				openrouter: mockModels,
				requesty: {},
				unbound: mockModels,
				"vercel-ai-gateway": mockModels,
				"zoo-gateway": mockModels,
				litellm: {},
				ollama: {},
				lmstudio: {},
				poe: {},
				deepseek: {},
				moonshot: {},
				"opencode-go": mockModels,
				kenari: mockModels,
				"kimi-code": {},
			},
			values: undefined,
		})
	})

	it("handles Error objects and string errors correctly", async () => {
		// Mock providers to fail with different error types
		mockGetModels
			.mockRejectedValueOnce(new Error("Structured error message")) // openrouter
			.mockRejectedValueOnce(new Error("Requesty API error")) // requesty
			.mockRejectedValueOnce(new Error("Unbound error")) // unbound
			.mockRejectedValueOnce(new Error("Vercel AI Gateway error")) // vercel-ai-gateway
			.mockRejectedValueOnce(new Error("Zoo Gateway error")) // zoo-gateway
			.mockRejectedValueOnce(new Error("LiteLLM connection failed")) // litellm

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
		})

		// Verify error handling for different error types
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Structured error message",
			values: { provider: "openrouter" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Requesty API error",
			values: { provider: "requesty" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Unbound error",
			values: { provider: "unbound" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Vercel AI Gateway error",
			values: { provider: "vercel-ai-gateway" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "LiteLLM connection failed",
			values: { provider: "litellm" },
		})
	})

	it("returns an explicit removal error for requestRooModels", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "requestRooModels",
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Roo Code Router has been removed. Please select and configure a different provider.",
			values: { provider: "roo" },
		})
	})

	it("prefers message values over config values for LiteLLM", async () => {
		const mockModels: ModelRecord = {}
		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
			values: {
				litellmApiKey: "message-key",
				litellmBaseUrl: "http://message-url",
			},
		})

		// Verify message values take precedence over saved config (current unsaved field state wins)
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "message-key", // From message.values
			baseUrl: "http://message-url", // From message.values
		})
	})
})

describe("webviewMessageHandler - requestOpenAiCodexRateLimits", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockGetAccessToken.mockResolvedValue(null)
		mockGetAccountId.mockResolvedValue(null)
	})

	it("posts error when not authenticated", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "requestOpenAiCodexRateLimits",
		} as unknown as Parameters<typeof webviewMessageHandler>[1])

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "openAiCodexRateLimits",
			error: "Not authenticated with OpenAI Codex",
		})
	})

	it("posts values when authenticated", async () => {
		mockGetAccessToken.mockResolvedValue("token")
		mockGetAccountId.mockResolvedValue("acct_123")
		mockFetchOpenAiCodexRateLimitInfo.mockResolvedValue({
			primary: { usedPercent: 10, resetsAt: 1700000000000 },
			fetchedAt: 1700000000000,
		})

		await webviewMessageHandler(mockClineProvider, {
			type: "requestOpenAiCodexRateLimits",
		} as unknown as Parameters<typeof webviewMessageHandler>[1])

		expect(mockFetchOpenAiCodexRateLimitInfo).toHaveBeenCalledWith("token", { accountId: "acct_123" })
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "openAiCodexRateLimits",
			values: {
				primary: { usedPercent: 10, resetsAt: 1700000000000 },
				fetchedAt: 1700000000000,
			},
		})
	})
})

describe("webviewMessageHandler - deleteCustomMode", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getWorkspacePath).mockReturnValue("/mock/workspace")
		vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined)
		vi.mocked(ensureSettingsDirectoryExists).mockResolvedValue("/mock/global/storage/.roo")
	})

	it("should delete a project mode and its rules folder", async () => {
		const slug = "test-project-mode"
		const rulesFolderPath = path.join("/mock/workspace", ".roo", `rules-${slug}`)

		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Project Mode",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "project",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		// The confirmation dialog is now handled in the webview, so we don't expect showInformationMessage to be called
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).toHaveBeenCalledWith(rulesFolderPath, { recursive: true, force: true })
	})

	it("should delete a global mode and its rules folder", async () => {
		const slug = "test-global-mode"
		const homeDir = os.homedir()
		const rulesFolderPath = path.join(homeDir, ".roo", `rules-${slug}`)

		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Global Mode",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "global",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		// The confirmation dialog is now handled in the webview, so we don't expect showInformationMessage to be called
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).toHaveBeenCalledWith(rulesFolderPath, { recursive: true, force: true })
	})

	it("should only delete the mode when rules folder does not exist", async () => {
		const slug = "test-mode-no-rules"
		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Mode No Rules",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "project",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(false)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		// The confirmation dialog is now handled in the webview, so we don't expect showInformationMessage to be called
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).not.toHaveBeenCalled()
	})

	it("should handle errors when deleting rules folder", async () => {
		const slug = "test-mode-error"
		const rulesFolderPath = path.join("/mock/workspace", ".roo", `rules-${slug}`)
		const error = new Error("Permission denied")

		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Mode Error",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "project",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)
		vi.mocked(fs.rm).mockRejectedValue(error)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).toHaveBeenCalledWith(rulesFolderPath, { recursive: true, force: true })
		// Verify error message is shown to the user
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			t("common:errors.delete_rules_folder_failed", {
				rulesFolderPath,
				error: error.message,
			}),
		)
		// No error response is sent anymore - we just continue with deletion
		expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - message dialog preferences", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Mock a current Cline instance
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			taskId: "test-task-id",
			apiConversationHistory: [],
			clineMessages: [],
		} as unknown as ReturnType<ClineProvider["getCurrentTask"]>)
		// Reset getValue mock
		vi.mocked(mockClineProvider.contextProxy.getValue).mockReturnValue(false)
	})

	describe("deleteMessage", () => {
		it("should always show dialog for delete confirmation", async () => {
			vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
				clineMessages: [],
				apiConversationHistory: [],
			} as unknown as ReturnType<ClineProvider["getCurrentTask"]>) // Mock current cline with proper structure

			await webviewMessageHandler(mockClineProvider, {
				type: "deleteMessage",
				value: 123456789, // Changed from messageTs to value
			})

			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "showDeleteMessageDialog",
				messageTs: 123456789,
				hasCheckpoint: false,
			})
		})
		it("sends an editor-initiated confirmation only to the originating Webview", async () => {
			const editorWebview = { postMessage: vi.fn() } as unknown as vscode.Webview
			vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
				clineMessages: [],
				apiConversationHistory: [],
			} as unknown as ReturnType<ClineProvider["getCurrentTask"]>)

			await webviewMessageHandler(
				mockClineProvider,
				{ type: "deleteMessage", value: 123456789 },
				undefined,
				editorWebview,
			)

			expect(mockClineProvider.postMessageToSpecificWebview).toHaveBeenCalledWith(editorWebview, {
				type: "showDeleteMessageDialog",
				messageTs: 123456789,
				hasCheckpoint: false,
			})
			expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalled()
		})
	})

	describe("submitEditedMessage", () => {
		it("should always show dialog for edit confirmation", async () => {
			vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
				clineMessages: [],
				apiConversationHistory: [],
			} as unknown as ReturnType<ClineProvider["getCurrentTask"]>) // Mock current cline with proper structure

			await webviewMessageHandler(mockClineProvider, {
				type: "submitEditedMessage",
				value: 123456789,
				editedMessageContent: "edited content",
			})

			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 123456789,
				text: "edited content",
				hasCheckpoint: false,
				images: undefined,
			})
		})
		it("sends an editor-initiated edit confirmation only to the originating Webview", async () => {
			const editorWebview = { postMessage: vi.fn() } as unknown as vscode.Webview
			vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
				clineMessages: [],
				apiConversationHistory: [],
			} as unknown as ReturnType<ClineProvider["getCurrentTask"]>)

			await webviewMessageHandler(
				mockClineProvider,
				{ type: "submitEditedMessage", value: 123456789, editedMessageContent: "edited content" },
				undefined,
				editorWebview,
			)

			expect(mockClineProvider.postMessageToSpecificWebview).toHaveBeenCalledWith(editorWebview, {
				type: "showEditMessageDialog",
				messageTs: 123456789,
				text: "edited content",
				hasCheckpoint: false,
				images: undefined,
			})
			expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalled()
		})
	})
})

describe("webviewMessageHandler - mcpEnabled", () => {
	let mockMcpHub: { handleMcpEnabledChange: Mock }
	let getMcpHub: Mock

	beforeEach(() => {
		vi.clearAllMocks()

		// Create a mock McpHub instance
		mockMcpHub = {
			handleMcpEnabledChange: vi.fn().mockResolvedValue(undefined),
		}

		// Ensure provider exposes getMcpHub and returns our mock
		getMcpHub = vi.fn().mockReturnValue(mockMcpHub)
		Reflect.set(mockClineProvider, "getMcpHub", getMcpHub)
	})

	it("delegates enable=true to McpHub and posts updated state", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { mcpEnabled: true },
		})

		expect(getMcpHub).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledWith(true)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalledTimes(1)
	})

	it("delegates enable=false to McpHub and posts updated state", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { mcpEnabled: false },
		})

		expect(getMcpHub).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledWith(false)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalledTimes(1)
	})

	it("handles missing McpHub instance gracefully and still posts state", async () => {
		getMcpHub = vi.fn().mockReturnValue(undefined)
		Reflect.set(mockClineProvider, "getMcpHub", getMcpHub)

		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { mcpEnabled: true },
		})

		expect(getMcpHub).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalledTimes(1)
	})
})

describe("webviewMessageHandler - dedicated IDE layout", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("persists and opens the dedicated layout when the setting is enabled", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { dedicatedIdeLayoutEnabled: true },
		})

		expect(mockClineProvider.contextProxy.setValue).toHaveBeenCalledWith("dedicatedIdeLayoutEnabled", true)
		expect(mockClineProvider.openDedicatedIdeLayout).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.disableDedicatedIdeLayout).not.toHaveBeenCalled()
		expect(mockClineProvider.postStateToWebview).not.toHaveBeenCalled()
	})

	it("persists and disables the dedicated layout without closing the editor view", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { dedicatedIdeLayoutEnabled: false },
		})

		expect(mockClineProvider.contextProxy.setValue).toHaveBeenCalledWith("dedicatedIdeLayoutEnabled", false)
		expect(mockClineProvider.disableDedicatedIdeLayout).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.openDedicatedIdeLayout).not.toHaveBeenCalled()
	})

	it("routes dedicated editor approval actions to the composer", async () => {
		await webviewMessageHandler(mockClineProvider, { type: "requestComposerPrimaryButtonClick" })
		await webviewMessageHandler(mockClineProvider, { type: "requestComposerSecondaryButtonClick" })

		expect(mockClineProvider.requestComposerPrimaryButtonClick).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.requestComposerSecondaryButtonClick).toHaveBeenCalledTimes(1)
	})

	it("routes a dedicated editor suggestion to the composer draft", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "requestComposerDraftAppend",
			text: "Use the existing sidebar behavior",
		})

		expect(mockClineProvider.requestComposerDraftAppend).toHaveBeenCalledWith("Use the existing sidebar behavior")
	})

	it("routes the composer settings request and section to the dedicated editor", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "openSettingsInMainView",
			values: { section: "providers" },
		})

		expect(mockClineProvider.openSettingsInDedicatedEditor).toHaveBeenCalledWith("providers")
	})
})

describe("webviewMessageHandler - user avatar", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("keeps avatar commits out of the general settings payload", async () => {
		await webviewMessageHandler(mockClineProvider, { type: "commitUserAvatar" })

		expect(mockClineProvider.commitUserAvatar).toHaveBeenCalledWith(undefined, false)
		expect(mockClineProvider.contextProxy.setValue).not.toHaveBeenCalled()
	})

	it("commits a pending avatar removal only after settings save", async () => {
		await webviewMessageHandler(mockClineProvider, { type: "commitUserAvatar", bool: true })

		expect(mockClineProvider.commitUserAvatar).toHaveBeenCalledWith(undefined, true)
	})

	it("discards a staged avatar without changing the saved avatar", async () => {
		await webviewMessageHandler(mockClineProvider, { type: "discardUserAvatar" })

		expect(mockClineProvider.discardUserAvatar).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.contextProxy.setValue).not.toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - destructiveCommandGuardEnabled", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(ensureDcgInstalled).mockResolvedValue("/mock/global/storage/dcg")
	})

	it("installs and persists destructive command guard when enabled", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { destructiveCommandGuardEnabled: true },
		})

		expect(ensureDcgInstalled).toHaveBeenCalledWith("/mock/global/storage")
		expect(mockClineProvider.contextProxy.setValue).toHaveBeenCalledWith("destructiveCommandGuardEnabled", true)
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
	})

	it("disables the setting and reports an installation failure", async () => {
		vi.mocked(ensureDcgInstalled).mockRejectedValue(new Error("checksum mismatch"))

		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { destructiveCommandGuardEnabled: true },
		})

		expect(mockClineProvider.contextProxy.setValue).toHaveBeenCalledWith("destructiveCommandGuardEnabled", false)
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			"common:errors.destructiveCommandGuard.enableFailed",
		)
	})

	it("disables the setting when DCG is unavailable for the current platform", async () => {
		vi.mocked(ensureDcgInstalled).mockResolvedValue(undefined)

		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { destructiveCommandGuardEnabled: true },
		})

		expect(mockClineProvider.contextProxy.setValue).toHaveBeenCalledWith("destructiveCommandGuardEnabled", false)
		expect(t).toHaveBeenCalledWith("common:errors.destructiveCommandGuard.unavailable")
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:errors.destructiveCommandGuard.unavailable")
		expect(t).not.toHaveBeenCalledWith("common:errors.destructiveCommandGuard.enableFailed", expect.anything())
	})

	it("reports non-Error installation failures", async () => {
		vi.mocked(ensureDcgInstalled).mockRejectedValue("download unavailable")

		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { destructiveCommandGuardEnabled: true },
		})

		expect(mockClineProvider.contextProxy.setValue).toHaveBeenCalledWith("destructiveCommandGuardEnabled", false)
		expect(t).toHaveBeenCalledWith("common:errors.destructiveCommandGuard.enableFailed", {
			error: "download unavailable",
		})
	})

	it("persists disabled state without trying to install", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { destructiveCommandGuardEnabled: false },
		})

		expect(ensureDcgInstalled).not.toHaveBeenCalled()
		expect(mockClineProvider.contextProxy.setValue).toHaveBeenCalledWith("destructiveCommandGuardEnabled", false)
	})
})

describe("webviewMessageHandler - terminalProfile", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		Terminal.setTerminalProfile(undefined)
	})

	afterEach(() => {
		Terminal.setTerminalProfile(undefined)
		vi.restoreAllMocks()
	})

	it("normalizes and persists a saved terminalProfile, then closes stale idle terminals", async () => {
		const closeIdleTerminalsSpy = vi.spyOn(TerminalRegistry, "closeIdleTerminals").mockImplementation(() => {})

		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { terminalProfile: " Git Bash " },
		})

		expect(Terminal.getTerminalProfile()).toBe("Git Bash")
		expect(mockClineProvider.contextProxy.setValue).toHaveBeenCalledWith("terminalProfile", "Git Bash")
		expect(closeIdleTerminalsSpy).toHaveBeenCalledTimes(1)
	})

	it("does not close idle terminals when hydration sends the unchanged profile", async () => {
		Terminal.setTerminalProfile("Git Bash")
		const closeIdleTerminalsSpy = vi.spyOn(TerminalRegistry, "closeIdleTerminals").mockImplementation(() => {})

		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { terminalProfile: " Git Bash " },
		})

		expect(mockClineProvider.contextProxy.setValue).toHaveBeenCalledWith("terminalProfile", "Git Bash")
		expect(closeIdleTerminalsSpy).not.toHaveBeenCalled()
	})

	it("clears the persisted profile when SettingsView sends the empty-string sentinel", async () => {
		Terminal.setTerminalProfile("Git Bash")
		const closeIdleTerminalsSpy = vi.spyOn(TerminalRegistry, "closeIdleTerminals").mockImplementation(() => {})

		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { terminalProfile: "" },
		})

		expect(Terminal.getTerminalProfile()).toBeUndefined()
		expect(mockClineProvider.contextProxy.setValue).toHaveBeenCalledWith("terminalProfile", undefined)
		expect(closeIdleTerminalsSpy).toHaveBeenCalledTimes(1)
	})

	it("does not close idle terminals when the empty-string sentinel leaves the profile unset", async () => {
		const closeIdleTerminalsSpy = vi.spyOn(TerminalRegistry, "closeIdleTerminals").mockImplementation(() => {})

		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { terminalProfile: "" },
		})

		expect(mockClineProvider.contextProxy.setValue).toHaveBeenCalledWith("terminalProfile", undefined)
		expect(closeIdleTerminalsSpy).not.toHaveBeenCalled()
	})

	it("treats non-string terminalProfile values as unset", async () => {
		Terminal.setTerminalProfile("Git Bash")
		const closeIdleTerminalsSpy = vi.spyOn(TerminalRegistry, "closeIdleTerminals").mockImplementation(() => {})

		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { terminalProfile: 42 as unknown as string },
		})

		expect(Terminal.getTerminalProfile()).toBeUndefined()
		expect(mockClineProvider.contextProxy.setValue).toHaveBeenCalledWith("terminalProfile", undefined)
		expect(closeIdleTerminalsSpy).toHaveBeenCalledTimes(1)
	})
})

describe("webviewMessageHandler - requestTerminalProfiles", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("posts available profile names", async () => {
		vi.spyOn(Terminal, "getAvailableProfileNames").mockReturnValue(["Git Bash", "bash"])

		await webviewMessageHandler(mockClineProvider, { type: "requestTerminalProfiles" })

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "terminalProfiles",
			profiles: ["Git Bash", "bash"],
		})
	})

	it("posts an empty array when profile discovery throws", async () => {
		vi.spyOn(Terminal, "getAvailableProfileNames").mockImplementation(() => {
			throw new Error("config error")
		})

		await webviewMessageHandler(mockClineProvider, { type: "requestTerminalProfiles" })

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "terminalProfiles",
			profiles: [],
		})
	})
})

describe("webviewMessageHandler - openTerminalProfilePicker", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("executes the VS Code selectDefaultShell command", async () => {
		await webviewMessageHandler(mockClineProvider, { type: "openTerminalProfilePicker" })
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith("workbench.action.terminal.selectDefaultShell")
	})
})

describe("webviewMessageHandler - requestCommands", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("includes skill slug commands and dedupes duplicate skill names while preserving first skill entry", async () => {
		mockGetCommands.mockResolvedValue([])

		const getTaskMode = vi.fn().mockResolvedValue("code")
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			getTaskMode,
		} as unknown as ReturnType<ClineProvider["getCurrentTask"]>)

		const getSkillsForMode = vi.fn().mockReturnValue([
			{
				name: "skill-slug-entry",
				description: "Primary skill slug",
				path: "/mock/.roo/skills/skill-slug-entry/SKILL.md",
				source: "project",
				modeSlugs: ["code"],
			},
			{
				name: "skill-slug-entry",
				description: "Duplicate skill slug",
				path: "/mock/.roo/skills/duplicate-skill/SKILL.md",
				source: "global",
				modeSlugs: ["code"],
			},
			{
				name: "another-skill-slug",
				description: "Another skill-generated command",
				path: "/mock/.roo/skills/another-skill-slug/SKILL.md",
				source: "global",
				modeSlugs: ["code"],
			},
		])

		vi.mocked(mockClineProvider.getSkillsManager).mockReturnValue({
			getSkillsForMode,
		} as unknown as ReturnType<ClineProvider["getSkillsManager"]>)

		await webviewMessageHandler(mockClineProvider, { type: "requestCommands" })

		const commandMessageCall = vi
			.mocked(mockClineProvider.postMessageToWebview)
			.mock.calls.find(([postedMessage]) => postedMessage.type === "commands")
		expect(commandMessageCall).toBeDefined()

		const commandMessage = commandMessageCall?.[0]
		expect(commandMessage?.commands).toEqual(
			expect.arrayContaining([
				{
					name: "skill-slug-entry",
					source: "project",
					filePath: "/mock/.roo/skills/skill-slug-entry/SKILL.md",
					description: "Primary skill slug",
				},
				{
					name: "another-skill-slug",
					source: "global",
					filePath: "/mock/.roo/skills/another-skill-slug/SKILL.md",
					description: "Another skill-generated command",
				},
			]),
		)

		expect(commandMessage?.commands?.filter((command) => command.name === "skill-slug-entry")).toHaveLength(1)
	})

	it("adds skill-backed command entries without overriding existing command names", async () => {
		mockGetCommands.mockResolvedValue([
			{
				name: "deploy",
				content: "existing command",
				source: "project",
				filePath: "/mock/workspace/.roo/commands/deploy.md",
				description: "Deploy command",
				argumentHint: "staging | production",
			},
		])

		const getTaskMode = vi.fn().mockResolvedValue("code")
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
			getTaskMode,
		} as unknown as ReturnType<ClineProvider["getCurrentTask"]>)

		const getSkillsForMode = vi.fn().mockReturnValue([
			{
				name: "deploy",
				description: "Deploy skill",
				path: "/mock/.roo/skills/deploy/SKILL.md",
				source: "global",
				modeSlugs: ["code"],
			},
			{
				name: "skill-only",
				description: "Skill-generated command",
				path: "/mock/.roo/skills/skill-only/SKILL.md",
				source: "project",
				modeSlugs: ["code"],
			},
		])

		vi.mocked(mockClineProvider.getSkillsManager).mockReturnValue({
			getSkillsForMode,
		} as unknown as ReturnType<ClineProvider["getSkillsManager"]>)

		await webviewMessageHandler(mockClineProvider, { type: "requestCommands" })

		expect(getSkillsForMode).toHaveBeenCalledWith("code")

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "commands",
			commands: expect.arrayContaining([
				{
					name: "deploy",
					source: "project",
					filePath: "/mock/workspace/.roo/commands/deploy.md",
					description: "Deploy command",
					argumentHint: "staging | production",
				},
				{
					name: "skill-only",
					source: "project",
					filePath: "/mock/.roo/skills/skill-only/SKILL.md",
					description: "Skill-generated command",
				},
			]),
		})

		const commandMessageCall = vi
			.mocked(mockClineProvider.postMessageToWebview)
			.mock.calls.find(([postedMessage]) => postedMessage.type === "commands")
		expect(commandMessageCall).toBeDefined()

		const commandMessage = commandMessageCall?.[0]
		expect(commandMessage?.commands?.filter((command) => command.name === "deploy")).toHaveLength(1)
	})

	it("preserves existing behavior when skills manager is unavailable", async () => {
		mockGetCommands.mockResolvedValue([
			{
				name: "build",
				content: "build command",
				source: "built-in",
				filePath: "<built-in:build>",
				description: "Build command",
				argumentHint: "target",
			},
		])

		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/workspace",
		} as unknown as ReturnType<ClineProvider["getCurrentTask"]>)

		vi.mocked(mockClineProvider.getSkillsManager).mockReturnValue(undefined)

		await webviewMessageHandler(mockClineProvider, { type: "requestCommands" })

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "commands",
			commands: [
				{
					name: "build",
					source: "built-in",
					filePath: "<built-in:build>",
					description: "Build command",
					argumentHint: "target",
				},
			],
		})
	})
})

describe("webviewMessageHandler - rules", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue(undefined)
		Reflect.set(mockClineProvider, "cwd", "/mock/workspace")
	})

	it("routes rules management messages with the current workspace", async () => {
		const messages = [
			{ type: "requestRules" },
			{ type: "createRule", values: { scope: "project", kind: "generic", fileName: "new.md" } },
			{ type: "deleteRule", values: { scope: "project", kind: "generic", relativePath: "old.md" } },
			{ type: "openRuleFile", values: { scope: "global", kind: "generic", relativePath: "global.md" } },
			{ type: "openRulesDirectory", values: { scope: "project", kind: "mode", modeSlug: "code" } },
		] as const

		for (const message of messages) {
			await webviewMessageHandler(mockClineProvider, message as Parameters<typeof webviewMessageHandler>[1])
		}

		expect(handleRequestRules).toHaveBeenCalledWith(mockClineProvider, "/mock/workspace")
		expect(handleCreateRule).toHaveBeenCalledWith(mockClineProvider, "/mock/workspace", messages[1])
		expect(handleDeleteRule).toHaveBeenCalledWith(mockClineProvider, "/mock/workspace", messages[2])
		expect(handleOpenRuleFile).toHaveBeenCalledWith(mockClineProvider, "/mock/workspace", messages[3])
		expect(handleOpenRulesDirectory).toHaveBeenCalledWith(mockClineProvider, "/mock/workspace", messages[4])
	})

	it("uses the active task cwd when routing rule messages", async () => {
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			cwd: "/mock/task-workspace",
		} as unknown as ReturnType<ClineProvider["getCurrentTask"]>)

		const message = { type: "requestRules" } as const
		await webviewMessageHandler(mockClineProvider, message as Parameters<typeof webviewMessageHandler>[1])

		expect(handleRequestRules).toHaveBeenCalledWith(mockClineProvider, "/mock/task-workspace")
	})
})

describe("webviewMessageHandler - automatic webview crash logging", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			taskId: "active-task-id",
		} as unknown as ReturnType<ClineProvider["getCurrentTask"]>)
	})

	it("automatically appends crash diagnostics to the extension log directory", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "webviewCrash",
			webviewCrash: {
				stage: "error-boundary",
				name: "Error",
				message: "input crashed",
				stack: "stack trace",
				componentStack: "ChatTextArea",
			},
		})

		expect(fs.appendFile).toHaveBeenCalledWith(
			path.join("/mock/extension/logs", "webview-crashes.ndjson"),
			expect.stringContaining('"message":"input crashed"'),
			"utf8",
		)
		expect(mockClineProvider.log).toHaveBeenCalledWith(
			expect.stringContaining("Automatically saved webview crash diagnostics to"),
		)
	})
})

describe("webviewMessageHandler - downloadErrorDiagnostics", () => {
	beforeEach(() => {
		vi.clearAllMocks()

		// Ensure contextProxy has a globalStorageUri for the handler
		Reflect.set(mockClineProvider.contextProxy, "globalStorageUri", { fsPath: "/mock/global/storage" })

		// Provide a current task with a stable ID
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			taskId: "test-task-id",
		} as unknown as ReturnType<ClineProvider["getCurrentTask"]>)
	})

	it("calls generateErrorDiagnostics with correct parameters", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "downloadErrorDiagnostics",
			values: {
				timestamp: "2025-01-01T00:00:00.000Z",
				version: "1.2.3",
				provider: "test-provider",
				model: "test-model",
				details: "Sample error details",
			},
		} as Parameters<typeof webviewMessageHandler>[1])

		// Verify generateErrorDiagnostics was called with the correct parameters
		expect(generateErrorDiagnostics).toHaveBeenCalledTimes(1)
		expect(generateErrorDiagnostics).toHaveBeenCalledWith({
			taskId: "test-task-id",
			globalStoragePath: "/mock/global/storage",
			values: {
				timestamp: "2025-01-01T00:00:00.000Z",
				version: "1.2.3",
				provider: "test-provider",
				model: "test-model",
				details: "Sample error details",
			},
			log: expect.any(Function),
		})
	})

	it("shows error when no active task", async () => {
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue(
			null as unknown as ReturnType<ClineProvider["getCurrentTask"]>,
		)

		await webviewMessageHandler(mockClineProvider, {
			type: "downloadErrorDiagnostics",
			values: {},
		} as Parameters<typeof webviewMessageHandler>[1])

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("No active task to generate diagnostics for")
		expect(generateErrorDiagnostics).not.toHaveBeenCalled()
	})
})

describe("zooCodeSignOut", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("disconnects Zoo Code and clears tokens from all Zoo Gateway profiles", async () => {
		const { disconnectZooCode } = await import("../../../services/zoo-code-auth")
		const upsertProviderProfile = vi.fn().mockResolvedValue(undefined)
		const saveConfig = vi.fn().mockResolvedValue(undefined)

		Reflect.set(mockClineProvider, "contextProxy", {
			...mockClineProvider.contextProxy,
			getProviderSettings: vi.fn().mockReturnValue({ apiProvider: "zoo-gateway" }),
			getValues: vi.fn().mockReturnValue({ currentApiConfigName: "Zoo Gateway" }),
		})
		Reflect.set(mockClineProvider, "providerSettingsManager", {
			listConfig: vi.fn().mockResolvedValue([
				{ name: "Zoo Gateway", apiProvider: "zoo-gateway" },
				{ name: "Backup Zoo", apiProvider: "zoo-gateway" },
			]),
			getProfile: vi
				.fn()
				.mockResolvedValueOnce({
					apiProvider: "zoo-gateway",
					zooSessionToken: "token-active",
					zooGatewayModelId: "anthropic/claude-sonnet-4",
				})
				.mockResolvedValueOnce({
					apiProvider: "zoo-gateway",
					zooSessionToken: "token-backup",
				}),
			saveConfig,
		})
		Reflect.set(mockClineProvider, "upsertProviderProfile", upsertProviderProfile)

		await webviewMessageHandler(mockClineProvider, { type: "zooCodeSignOut" })

		expect(disconnectZooCode).toHaveBeenCalled()
		expect(upsertProviderProfile).toHaveBeenCalledWith(
			"Zoo Gateway",
			expect.not.objectContaining({ zooSessionToken: expect.anything() }),
			true,
		)
		expect(saveConfig).toHaveBeenCalledWith(
			"Backup Zoo",
			expect.not.objectContaining({ zooSessionToken: expect.anything() }),
		)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("still clears the in-memory handler when the active profile token is already empty on disk", async () => {
		const upsertProviderProfile = vi.fn().mockResolvedValue(undefined)

		Reflect.set(mockClineProvider, "contextProxy", {
			...mockClineProvider.contextProxy,
			getProviderSettings: vi.fn().mockReturnValue({ apiProvider: "zoo-gateway" }),
			getValues: vi.fn().mockReturnValue({ currentApiConfigName: "Zoo Gateway" }),
		})
		Reflect.set(mockClineProvider, "providerSettingsManager", {
			listConfig: vi.fn().mockResolvedValue([{ name: "Zoo Gateway", apiProvider: "zoo-gateway" }]),
			getProfile: vi.fn().mockResolvedValue({
				apiProvider: "zoo-gateway",
				zooGatewayModelId: "anthropic/claude-sonnet-4",
			}),
			saveConfig: vi.fn(),
		})
		Reflect.set(mockClineProvider, "upsertProviderProfile", upsertProviderProfile)

		await webviewMessageHandler(mockClineProvider, { type: "zooCodeSignOut" })

		expect(upsertProviderProfile).toHaveBeenCalledWith(
			"Zoo Gateway",
			expect.not.objectContaining({ zooSessionToken: expect.anything() }),
			true,
		)
	})
})

describe("webviewMessageHandler - kimiCodeSignIn", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.resetModules()
	})

	it("starts OAuth authorization and opens browser", async () => {
		const mockStartAuthorization = vi.fn().mockResolvedValue({
			userCode: "TEST-CODE",
			verificationUri: "https://auth.kimi.com/device",
			expiresAt: Date.now() + 600000,
		})
		const mockWaitForAuthorization = vi.fn().mockResolvedValue({
			type: "kimi-code",
			accessToken: "token",
			refreshToken: "refresh",
			expiresAt: Date.now() + 3600000,
		})

		vi.doMock("../../../integrations/kimi-code/oauth", () => ({
			kimiCodeOAuthManager: {
				startAuthorization: mockStartAuthorization,
				waitForAuthorization: mockWaitForAuthorization,
			},
		}))

		const mockOpenExternal = vi.mocked(vscode.env.openExternal).mockResolvedValue(true)

		await webviewMessageHandler(mockClineProvider, { type: "kimiCodeSignIn" })

		expect(mockStartAuthorization).toHaveBeenCalled()
		expect(mockOpenExternal).toHaveBeenCalled()
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("shows success message after successful authorization", async () => {
		const mockStartAuthorization = vi.fn().mockResolvedValue({
			userCode: "TEST-CODE",
			verificationUri: "https://auth.kimi.com/device",
			expiresAt: Date.now() + 600000,
		})
		const mockWaitForAuthorization = vi.fn().mockResolvedValue({
			type: "kimi-code",
			accessToken: "token",
			refreshToken: "refresh",
			expiresAt: Date.now() + 3600000,
		})

		vi.doMock("../../../integrations/kimi-code/oauth", () => ({
			kimiCodeOAuthManager: {
				startAuthorization: mockStartAuthorization,
				waitForAuthorization: mockWaitForAuthorization,
			},
		}))

		vi.mocked(vscode.env.openExternal).mockResolvedValue(true)

		await webviewMessageHandler(mockClineProvider, { type: "kimiCodeSignIn" })
		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Successfully signed in to Kimi Code")
	})

	it("handles authorization failure", async () => {
		const mockStartAuthorization = vi.fn().mockResolvedValue({
			userCode: "TEST-CODE",
			verificationUri: "https://auth.kimi.com/device",
			expiresAt: Date.now() + 600000,
		})
		const mockWaitForAuthorization = vi.fn().mockRejectedValue(new Error("Authorization cancelled"))

		vi.doMock("../../../integrations/kimi-code/oauth", () => ({
			kimiCodeOAuthManager: {
				startAuthorization: mockStartAuthorization,
				waitForAuthorization: mockWaitForAuthorization,
			},
		}))

		vi.mocked(vscode.env.openExternal).mockResolvedValue(true)

		await webviewMessageHandler(mockClineProvider, { type: "kimiCodeSignIn" })
		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("handles startAuthorization error", async () => {
		const mockStartAuthorization = vi.fn().mockRejectedValue(new Error("Network error"))

		vi.doMock("../../../integrations/kimi-code/oauth", () => ({
			kimiCodeOAuthManager: {
				startAuthorization: mockStartAuthorization,
			},
		}))

		await webviewMessageHandler(mockClineProvider, { type: "kimiCodeSignIn" })

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Kimi Code sign in failed"))
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - reloadNekoNotifier", () => {
	it("reconfigures the notifier from the saved data directory", async () => {
		const { nekoNotifierClient } = await import("../../../integrations/notifications/nekoNotifierClient")
		const dataDirectory = "C:/Users/test/AppData/Local/NekoNotifier"
		vi.mocked(mockClineProvider.contextProxy.getGlobalState).mockReturnValue(dataDirectory)

		await webviewMessageHandler(mockClineProvider, { type: "reloadNekoNotifier" })

		expect(nekoNotifierClient.configure).toHaveBeenCalledWith(dataDirectory)
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "nekoNotifierStatus",
			active: true,
		})
	})

	it("returns the current notifier activation status", async () => {
		await webviewMessageHandler(mockClineProvider, { type: "requestNekoNotifierStatus" })

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "nekoNotifierStatus",
			active: true,
		})
	})
})

describe("webviewMessageHandler - kimiCodeSignOut", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.resetModules()
	})

	it("clears credentials and shows success message", async () => {
		const mockClearCredentials = vi.fn().mockResolvedValue(undefined)

		vi.doMock("../../../integrations/kimi-code/oauth", () => ({
			kimiCodeOAuthManager: {
				clearCredentials: mockClearCredentials,
			},
		}))

		await webviewMessageHandler(mockClineProvider, { type: "kimiCodeSignOut" })

		expect(mockClearCredentials).toHaveBeenCalled()
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("Signed out from Kimi Code")
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalled()
	})

	it("handles sign out error", async () => {
		const mockClearCredentials = vi.fn().mockRejectedValue(new Error("Clear failed"))

		vi.doMock("../../../integrations/kimi-code/oauth", () => ({
			kimiCodeOAuthManager: {
				clearCredentials: mockClearCredentials,
			},
		}))

		await webviewMessageHandler(mockClineProvider, { type: "kimiCodeSignOut" })

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Kimi Code sign out failed.")
	})
})
