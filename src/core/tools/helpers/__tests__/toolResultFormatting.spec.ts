import { describe, it, expect } from "vitest"
import { formatToolInvocation } from "../toolResultFormatting"

describe("toolResultFormatting", () => {
	describe("formatToolInvocation", () => {
		it("should format", () => {
			const result = formatToolInvocation("read_file", { path: "test.ts" })

			expect(result).toBe("已调用工具 read_file，带有参数 path: test.ts")
			expect(result).not.toContain("<")
		})

		it("should handle multiple parameters", () => {
			const result = formatToolInvocation("read_file", { path: "test.ts", start_line: "1" })

			expect(result).toContain("已调用工具 read_file，带有参数")
			expect(result).toContain("path: test.ts")
			expect(result).toContain("start_line: 1")
		})

		it("should handle empty parameters", () => {
			const result = formatToolInvocation("list_files", {})
			expect(result).toBe("已调用工具 list_files")
		})
	})
})
