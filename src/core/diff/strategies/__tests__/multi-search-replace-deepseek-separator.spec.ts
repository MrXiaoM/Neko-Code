// npx vitest run core/diff/strategies/__tests__/multi-search-replace-deepseek-separator.spec.ts

import { MultiSearchReplaceDiffStrategy } from "../multi-search-replace"

/**
 * Regression tests for DeepSeek emitting a malformed SEARCH separator line.
 *
 * DeepSeek occasionally writes the separator as `------->` (seven dashes plus a
 * trailing `>`) instead of the canonical `-------`. Before the fix, the optional
 * separator group in the extraction regex required exactly seven dashes, so the
 * malformed line was absorbed into the SEARCH content. That extra line dropped
 * the similarity below the threshold and produced errors like:
 *
 *   No sufficiently similar match found at line: 815 (98% similar, needs 100%)
 *
 * The fix tolerates a trailing `>` on the separator, mirroring the existing
 * tolerance for `<<<<<<< SEARCH>` markers.
 */
describe("MultiSearchReplaceDiffStrategy - malformed '------->' separator (DeepSeek)", () => {
	let strategy: MultiSearchReplaceDiffStrategy

	beforeEach(() => {
		strategy = new MultiSearchReplaceDiffStrategy()
	})

	it("applies a diff whose separator is written as '------->' with :start_line:", async () => {
		const originalContent = "line 1\nline 2\nline 3"
		const diffContent =
			"<<<<<<< SEARCH\n" +
			":start_line:2\n" +
			"------->\n" +
			"line 2\n" +
			"=======\n" +
			"line 2 changed\n" +
			">>>>>>> REPLACE"
		const result = await strategy.applyDiff(originalContent, diffContent)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe("line 1\nline 2 changed\nline 3")
		}
	})

	it("applies a diff whose separator is '------->' without :start_line:", async () => {
		const originalContent = "alpha\nbeta\ngamma"
		const diffContent = "<<<<<<< SEARCH\n" + "------->\n" + "beta\n" + "=======\n" + "beta!\n" + ">>>>>>> REPLACE"
		const result = await strategy.applyDiff(originalContent, diffContent)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe("alpha\nbeta!\ngamma")
		}
	})

	it("does not absorb the malformed separator into the SEARCH content", async () => {
		// Mirrors the deepseek-wrong-patch.json scenario: the '------->' line must be
		// treated as the separator marker, not as the first line of SEARCH content.
		const originalContent = "    </div>\n\n    <!-- Pagination -->\n    <div>x</div>"
		const diffContent =
			"<<<<<<< SEARCH\n" +
			":start_line:1\n" +
			"------->\n" +
			"    </div>\n" +
			"=======\n" +
			"    </section>\n" +
			">>>>>>> REPLACE"
		const result = await strategy.applyDiff(originalContent, diffContent)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe("    </section>\n\n    <!-- Pagination -->\n    <div>x</div>")
		}
	})

	it("handles a mix of malformed '------->' and well-formed '-------' separators", async () => {
		const originalContent = "one\ntwo\nthree\nfour"
		const diffContent =
			"<<<<<<< SEARCH\n" +
			":start_line:1\n" +
			"------->\n" +
			"one\n" +
			"=======\n" +
			"ONE\n" +
			">>>>>>> REPLACE\n\n" +
			"<<<<<<< SEARCH\n" +
			":start_line:3\n" +
			"-------\n" +
			"three\n" +
			"=======\n" +
			"THREE\n" +
			">>>>>>> REPLACE"
		const result = await strategy.applyDiff(originalContent, diffContent)
		expect(result.success).toBe(true)
		if (result.success) {
			expect(result.content).toBe("ONE\ntwo\nTHREE\nfour")
		}
	})
})
