import { describe, expect, it, vi } from "vitest"
import type * as vscode from "vscode"

import { API } from "../api"
import type { ClineProvider } from "../../core/webview/ClineProvider"

vi.mock("@roo-code/ipc", () => ({
	IpcServer: class {},
}))

describe("API - configuration", () => {
	it("replaces the current workspace mapping with every supplied mode API config", async () => {
		const setValues = vi.fn().mockResolvedValue(undefined)
		const saveConfig = vi.fn().mockResolvedValue("default-id")
		const setModeConfigs = vi.fn().mockResolvedValue(undefined)
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const provider = {
			context: {},
			on: vi.fn(),
			contextProxy: { setValues },
			providerSettingsManager: { saveConfig, setModeConfigs },
			postStateToWebview,
		} as unknown as ClineProvider
		const outputChannel = { appendLine: vi.fn() } as unknown as vscode.OutputChannel
		const api = new API(outputChannel, provider)

		await api.setConfiguration({
			currentApiConfigName: "default",
			modeApiConfigs: { code: "code-config", architect: "architect-config" },
		})

		expect(saveConfig).toHaveBeenCalledWith("default", expect.objectContaining({ currentApiConfigName: "default" }))
		expect(setValues).toHaveBeenCalledWith(
			expect.objectContaining({
				currentApiConfigName: "default",
				modeApiConfigs: expect.anything(),
			}),
		)
		expect(setModeConfigs).toHaveBeenCalledWith({ code: "code-config", architect: "architect-config" })
		expect(postStateToWebview).toHaveBeenCalledOnce()
	})

	it("does not persist mode mappings when none are supplied", async () => {
		const setValues = vi.fn().mockResolvedValue(undefined)
		const saveConfig = vi.fn().mockResolvedValue("default-id")
		const setModeConfigs = vi.fn().mockResolvedValue(undefined)
		const postStateToWebview = vi.fn().mockResolvedValue(undefined)
		const provider = {
			context: {},
			on: vi.fn(),
			contextProxy: { setValues },
			providerSettingsManager: { saveConfig, setModeConfigs },
			postStateToWebview,
		} as unknown as ClineProvider
		const outputChannel = { appendLine: vi.fn() } as unknown as vscode.OutputChannel
		const api = new API(outputChannel, provider)

		await api.setConfiguration({ currentApiConfigName: "default" })

		expect(setModeConfigs).not.toHaveBeenCalled()
		expect(postStateToWebview).toHaveBeenCalledOnce()
	})
})
