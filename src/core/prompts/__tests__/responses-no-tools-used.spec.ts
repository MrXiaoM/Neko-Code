// npx vitest core/prompts/__tests__/responses-no-tools-used.spec.ts

import { formatResponse } from "../responses"

describe("noToolsUsed 阶梯式响应", () => {
	describe("第一次失败（failedCount=1 或不传参）", () => {
		it("不应包含 [错误] 前缀", () => {
			const result = formatResponse.noToolsUsed(1)
			expect(result).not.toContain("[错误]")
		})

		it("应包含友好引导：「你的所有文本输出都应封装在工具调用中」", () => {
			const result = formatResponse.noToolsUsed(1)
			expect(result).toContain("你的所有文本输出都应封装在工具调用中")
		})

		it("应包含 attempt_completion 的具体指引（提到 result 参数）", () => {
			const result = formatResponse.noToolsUsed(1)
			expect(result).toContain("attempt_completion")
			expect(result).toContain("result")
		})

		it("应包含 ask_followup_question 指引", () => {
			const result = formatResponse.noToolsUsed(1)
			expect(result).toContain("ask_followup_question")
		})

		it("不应包含「连续」字样", () => {
			const result = formatResponse.noToolsUsed(1)
			expect(result).not.toMatch(/连续/)
		})

		it("不应包含「最后一次自动提醒」", () => {
			const result = formatResponse.noToolsUsed(1)
			expect(result).not.toContain("最后一次自动提醒")
		})

		it("不应包含「计入错误次数」", () => {
			const result = formatResponse.noToolsUsed(1)
			expect(result).not.toContain("计入错误次数")
		})

		it("应包含系统自动提醒免责声明", () => {
			const result = formatResponse.noToolsUsed(1)
			expect(result).toContain("系统自动提醒")
		})
	})

	describe("第二次及以上失败（failedCount >= 2）", () => {
		it("不应包含 [错误] 前缀", () => {
			const result = formatResponse.noToolsUsed(2)
			expect(result).not.toContain("[错误]")
		})

		it("应包含「连续 N 次未使用工具」的警告", () => {
			const result = formatResponse.noToolsUsed(2)
			expect(result).toMatch(/连续 \d+ 次未使用工具/)
		})

		it("应包含「最后一次自动提醒」", () => {
			const result = formatResponse.noToolsUsed(2)
			expect(result).toContain("最后一次自动提醒")
		})

		it("应包含「计入错误次数」的严重性警告", () => {
			const result = formatResponse.noToolsUsed(2)
			expect(result).toContain("计入错误次数")
		})

		it("应包含 attempt_completion 的具体指引", () => {
			const result = formatResponse.noToolsUsed(2)
			expect(result).toContain("attempt_completion")
			expect(result).toContain("result")
		})

		it("应包含「文字分析必须包装在工具调用里」的说明", () => {
			const result = formatResponse.noToolsUsed(2)
			expect(result).toContain("文字分析必须包装在工具调用里")
		})

		it("N=3 时应显示「连续 3 次」", () => {
			const result = formatResponse.noToolsUsed(3)
			expect(result).toContain("连续 3 次未使用工具")
		})

		it("N=5 时应显示「连续 5 次」", () => {
			const result = formatResponse.noToolsUsed(5)
			expect(result).toContain("连续 5 次未使用工具")
		})
	})

	describe("默认参数（不传 failedCount）", () => {
		it("应使用默认值 1，表现为第一次失败模式", () => {
			const result = formatResponse.noToolsUsed()
			expect(result).not.toContain("[错误]")
			expect(result).not.toContain("最后一次自动提醒")
			expect(result).toContain("你的所有文本输出都应封装在工具调用中")
		})
	})
})
