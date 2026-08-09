import React, { useMemo } from "react"
import Convert from "ansi-to-html"

interface TerminalOutputProps {
	content: string
	className?: string
	/**
	 * Output omitted from the visible preview. It is consumed only to restore
	 * ANSI SGR state (for example, a color enabled before the preview starts).
	 */
	ansiContext?: string
}

const createAnsiConverter = (preserveAnsiState: boolean) =>
	new Convert({
		fg: "var(--vscode-terminal-foreground, #cccccc)",
		bg: "var(--vscode-terminal-background, transparent)",
		// Map ANSI colors to VSCode terminal color CSS variables for theme compatibility
		colors: {
			0: "var(--vscode-terminal-ansiBlack, #000000)",
			1: "var(--vscode-terminal-ansiRed, #cd3131)",
			2: "var(--vscode-terminal-ansiGreen, #0dbc79)",
			3: "var(--vscode-terminal-ansiYellow, #e5e510)",
			4: "var(--vscode-terminal-ansiBlue, #2472c8)",
			5: "var(--vscode-terminal-ansiMagenta, #bc3fbc)",
			6: "var(--vscode-terminal-ansiCyan, #11a8cd)",
			7: "var(--vscode-terminal-ansiWhite, #e5e5e5)",
			8: "var(--vscode-terminal-ansiBrightBlack, #666666)",
			9: "var(--vscode-terminal-ansiBrightRed, #f14c4c)",
			10: "var(--vscode-terminal-ansiBrightGreen, #23d18b)",
			11: "var(--vscode-terminal-ansiBrightYellow, #f5f543)",
			12: "var(--vscode-terminal-ansiBrightBlue, #3b8eea)",
			13: "var(--vscode-terminal-ansiBrightMagenta, #d670d6)",
			14: "var(--vscode-terminal-ansiBrightCyan, #29b8db)",
			15: "var(--vscode-terminal-ansiBrightWhite, #e5e5e5)",
		},
		escapeXML: true, // Prevent XSS — escape HTML entities in the content
		newline: false, // We handle newlines ourselves via <pre>
		// Only preview tails need stateful parsing across two conversion calls. Normal
		// output must use a non-streaming converter so a terminal's unterminated SGR
		// sequence is closed within this render and cannot leak its colors.
		stream: preserveAnsiState,
	})

/**
 * Renders terminal output with ANSI color/formatting support.
 *
 * Uses ansi-to-html to convert ANSI escape sequences into styled <span> elements.
 * Colors are mapped to VSCode terminal theme CSS variables for consistent theming.
 *
 * The component uses a monospace font and preserves whitespace/newlines
 * to match terminal rendering behavior.
 */
export const TerminalOutput: React.FC<TerminalOutputProps> = ({ content, className, ansiContext = "" }) => {
	const html = useMemo(() => {
		try {
			// ansi-to-html tracks active SGR styles on each converter. A converter
			// must therefore never be shared between independently rendered command
			// outputs or streaming updates, otherwise an unterminated background
			// color can contaminate the following output. When a preview starts part
			// way through output, consume its hidden prefix with this fresh converter
			// so the visible tail keeps its original ANSI foreground/background state.
			const converter = createAnsiConverter(Boolean(ansiContext))
			if (ansiContext) {
				converter.toHtml(`\x1b[0m${ansiContext}`)
				// A streaming converter closes its rendered tags at the end of every
				// call. Do not append another reset here: ansi-to-html 0.7.x can emit
				// that control sequence as visible text after replaying sticky styles.
				// The converter is local to this render, so its remaining state cannot
				// contaminate another command output.
				return converter.toHtml(content)
			}
			return converter.toHtml(`\x1b[0m${content}\x1b[0m`)
		} catch {
			// Fallback: if conversion fails, show raw text (stripped of ANSI)
			// eslint-disable-next-line no-control-regex
			return content.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
		}
	}, [ansiContext, content])

	return (
		<pre
			className={className}
			style={{
				fontFamily:
					"var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', monospace)",
				fontSize: "var(--vscode-editor-font-size, 13px)",
				lineHeight: "var(--vscode-editor-line-height, 1.4)",
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
				margin: 0,
				padding: "8px 12px",
				backgroundColor: "var(--vscode-terminal-background, transparent)",
				color: "var(--vscode-terminal-foreground, inherit)",
				overflow: "auto",
				// Support Unicode box-drawing characters and extended ASCII
				unicodeBidi: "embed",
			}}
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	)
}
