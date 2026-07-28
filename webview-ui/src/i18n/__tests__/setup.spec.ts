import i18next from "../setup"

describe("WebView translation resources", () => {
	afterEach(async () => {
		await i18next.changeLanguage("en")
	})

	it("resolves the chat selector strings in simplified Chinese", async () => {
		await i18next.changeLanguage("zh-CN")

		expect(i18next.t("chat:modeSelector.title")).toBe("模式")
		expect(i18next.t("chat:apiConfigSelector.title")).toBe("API 配置")
		expect(i18next.t("chat:apiConfigSelector.searchPlaceholder")).toBe("搜索...")
		expect(i18next.t("chat:autoApprove.title")).toBe("自动批准")
		expect(i18next.t("chat:autoApprove.description")).toBe(
			"无需请求权限即可执行这些操作。仅对您完全信任的操作启用此功能。",
		)
		expect(i18next.t("chat:autoApprove.triggerLabelAll")).toBe("全部自动批准")
		expect(i18next.t("settings:autoApprove.readOnly.label")).toBe("读取")
	})
})
