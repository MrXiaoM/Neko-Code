import { supportPrompt } from "../support-prompt"

describe("Code Action Prompts", () => {
	const testFilePath = "test/file.ts"
	const testCode = "function test() { return true; }"

	describe("EXPLAIN action", () => {
		it("should format explain prompt correctly", () => {
			const prompt = supportPrompt.create("EXPLAIN", {
				filePath: testFilePath,
				selectedText: testCode,
			})
			expect(prompt).toContain(testFilePath)
			expect(prompt).toContain(testCode)
			expect(prompt).toContain("目的和功能")
			expect(prompt).toContain("关键组件")
			expect(prompt).toContain("重要模式")
		})
	})

	describe("FIX action", () => {
		it("should format fix prompt without diagnostics", () => {
			const prompt = supportPrompt.create("FIX", {
				filePath: testFilePath,
				selectedText: testCode,
			})
			expect(prompt).toContain(testFilePath)
			expect(prompt).toContain(testCode)
			expect(prompt).toContain("解决上面列出的所有检测到的问题")
			expect(prompt).not.toContain("当前检测到的问题")
		})

		it("should format fix prompt with diagnostics", () => {
			const diagnostics = [
				{
					source: "eslint",
					message: "Missing semicolon",
					code: "semi",
				},
				{
					message: "Unused variable",
					severity: 1,
				},
			]

			const prompt = supportPrompt.create("FIX", {
				filePath: testFilePath,
				selectedText: testCode,
				diagnostics,
			})

			expect(prompt).toContain("当前检测到的问题：")
			expect(prompt).toContain("[eslint] Missing semicolon (semi)")
			expect(prompt).toContain("[Error] Unused variable")
			expect(prompt).toContain(testCode)
		})
	})

	describe("IMPROVE action", () => {
		it("should format improve prompt correctly", () => {
			const prompt = supportPrompt.create("IMPROVE", {
				filePath: testFilePath,
				selectedText: testCode,
			})
			expect(prompt).toContain(testFilePath)
			expect(prompt).toContain(testCode)
			expect(prompt).toContain("代码可读性和可维护性")
			expect(prompt).toContain("性能优化")
			expect(prompt).toContain("最佳实践")
			expect(prompt).toContain("错误处理")
		})
	})

	describe("ENHANCE action", () => {
		it("should format enhance prompt correctly", () => {
			const prompt = supportPrompt.create("ENHANCE", {
				userInput: "test",
			})

			expect(prompt).toBe(
				"生成此提示词的增强版本（仅回复增强后的提示词——不要包含对话、解释、引言、要点、占位符或引号）：\n\ntest",
			)
			// Verify it ignores parameters since ENHANCE template doesn't use any
			expect(prompt).not.toContain(testFilePath)
			expect(prompt).not.toContain(testCode)
		})
	})

	describe("ADD_TO_CONTEXT action", () => {
		it("should format ADD_TO_CONTEXT prompt correctly with all parameters", () => {
			const prompt = supportPrompt.create("ADD_TO_CONTEXT", {
				name: "Roo",
				place: "Workspace",
				filePath: testFilePath,
				selectedText: testCode,
				startLine: "1",
				endLine: "1",
				diagnostics: [],
			})
			const expected = `${testFilePath}:1-1\n\`\`\`\n${testCode}\n\`\`\``
			expect(prompt).toBe(expected)
		})

		it("should format ADD_TO_CONTEXT prompt with diagnostics", () => {
			const diagnostics = [{ message: "Error 1" }, { source: "Linter", message: "Warning 2" }]
			const prompt = supportPrompt.create("ADD_TO_CONTEXT", {
				filePath: testFilePath,
				selectedText: testCode,
				startLine: "10",
				endLine: "20",
				diagnostics,
			})
			const expected = `${testFilePath}:10-20\n\`\`\`\n${testCode}\n\`\`\``
			expect(prompt).toBe(expected)
		})

		it("should not replace placeholders within parameter values", () => {
			const prompt = supportPrompt.create("ADD_TO_CONTEXT", {
				value1: "This is ${value2}",
				value2: "Actual Value 2",
				filePath: testFilePath,
				selectedText: testCode,
				startLine: "5",
				endLine: "15",
			})
			const expected = `${testFilePath}:5-15\n\`\`\`\n${testCode}\n\`\`\``
			expect(prompt).toBe(expected)
		})

		it("should replace remaining placeholders (not in params) with empty strings", () => {
			const prompt = supportPrompt.create("ADD_TO_CONTEXT", {
				name: "Roo",
				filePath: testFilePath,
				selectedText: testCode,
				startLine: "1",
				endLine: "1",
			}) // 'status' is missing
			const expected = `${testFilePath}:1-1\n\`\`\`\n${testCode}\n\`\`\``
			expect(prompt).toBe(expected)
		})

		it("should handle placeholders in values that are not in the template", () => {
			const prompt = supportPrompt.create("ADD_TO_CONTEXT", {
				data: "Some data with ${extraInfo}",
				filePath: testFilePath,
				selectedText: testCode,
				startLine: "1",
				endLine: "1",
			})
			const expected = `${testFilePath}:1-1\n\`\`\`\n${testCode}\n\`\`\``
			expect(prompt).toBe(expected)
		})

		it("should handle minimal params object", () => {
			const prompt = supportPrompt.create("ADD_TO_CONTEXT", {
				filePath: testFilePath,
				selectedText: testCode,
				startLine: "1",
				endLine: "1",
			})
			const expected = `${testFilePath}:1-1\n\`\`\`\n${testCode}\n\`\`\``
			expect(prompt).toBe(expected)
		})

		it("should handle params with non-string values", () => {
			const prompt = supportPrompt.create("ADD_TO_CONTEXT", {
				count: "5",
				isActive: "true",
				filePath: testFilePath,
				selectedText: testCode,
				startLine: "1",
				endLine: "1",
			}) // Convert to strings
			const expected = `${testFilePath}:1-1\n\`\`\`\n${testCode}\n\`\`\``
			expect(prompt).toBe(expected)
		})

		it("should handle keys with special regex characters", () => {
			const prompt = supportPrompt.create("ADD_TO_CONTEXT", {
				"key.with.dots": "Dotty",
				value: "Simple",
				filePath: testFilePath,
				selectedText: testCode,
				startLine: "1",
				endLine: "1",
			})
			const expected = `${testFilePath}:1-1\n\`\`\`\n${testCode}\n\`\`\``
			expect(prompt).toBe(expected)
		})

		it("should handle bash script selection", () => {
			const bashText =
				'if [ "${#usecase_deployments[@]}" -gt 0 ] && [ ${{ parameters.single_deployment_per_environment }} = true ]; then'
			const prompt = supportPrompt.create("ADD_TO_CONTEXT", {
				selectedText: bashText,
				filePath: testFilePath,
				startLine: "1",
				endLine: "1",
				diagnostics: [],
			})
			const expected = `${testFilePath}:1-1\n\`\`\`\n${bashText}\n\`\`\``
			expect(prompt).toBe(expected)
		})
	})

	describe("get template", () => {
		it("should return default template when no custom prompts provided", () => {
			const template = supportPrompt.get(undefined, "EXPLAIN")
			expect(template).toBe(supportPrompt.default.EXPLAIN)
		})

		it("should return custom template when provided", () => {
			const customTemplate = "Custom template for explaining code"
			const customSupportPrompts = {
				EXPLAIN: customTemplate,
			}
			const template = supportPrompt.get(customSupportPrompts, "EXPLAIN")
			expect(template).toBe(customTemplate)
		})

		it("should return default template when custom prompts does not include type", () => {
			const customSupportPrompts = {
				SOMETHING_ELSE: "Other template",
			}
			const template = supportPrompt.get(customSupportPrompts, "EXPLAIN")
			expect(template).toBe(supportPrompt.default.EXPLAIN)
		})
	})

	describe("create with custom prompts", () => {
		it("should use custom template when provided", () => {
			const customTemplate = "Custom template for ${filePath}"
			const customSupportPrompts = {
				EXPLAIN: customTemplate,
			}

			const prompt = supportPrompt.create(
				"EXPLAIN",
				{
					filePath: testFilePath,
					selectedText: testCode,
				},
				customSupportPrompts,
			)

			expect(prompt).toContain(`Custom template for ${testFilePath}`)
			expect(prompt).not.toContain("目的和功能")
		})

		it("should use default template when custom prompts does not include type", () => {
			const customSupportPrompts = {
				EXPLAIN: "Other template",
			}

			const prompt = supportPrompt.create(
				"EXPLAIN",
				{
					filePath: testFilePath,
					selectedText: testCode,
				},
				customSupportPrompts,
			)

			expect(prompt).toContain("Other template")
		})
	})
})
