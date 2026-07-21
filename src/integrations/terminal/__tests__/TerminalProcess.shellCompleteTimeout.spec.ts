// npx vitest run src/integrations/terminal/__tests__/TerminalProcess.shellCompleteTimeout.spec.ts
//
// Regression coverage for the Windows + Git Bash hang where VS Code never
// delivers a matching onDidEndTerminalShellExecution event (corrupted OSC 633
// markers, e.g. `npx` runs as `px`). The data stream still closes, but without
// the end event run() used to await shell_execution_complete forever, hanging
// the whole tool call. TerminalProcess.run() now bounds that wait and
// synthesizes completion so it always finishes.

import { TerminalProcess } from "../TerminalProcess"
import { Terminal } from "../Terminal"

vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue(null),
		}),
	},
	window: {
		createTerminal: vi.fn(),
		onDidStartTerminalShellExecution: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		onDidEndTerminalShellExecution: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		onDidCloseTerminal: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		onDidChangeTerminalShellIntegration: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	},
	ThemeIcon: class ThemeIcon {
		id: string
		constructor(id: string) {
			this.id = id
		}
	},
	Uri: {
		file: (p: string) => ({ fsPath: p }),
	},
}))

describe("TerminalProcess shell_execution_complete fallback timeout", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("synthesizes completion when the end event never arrives after the stream closes", async () => {
		vi.useFakeTimers()

		// A stream that yields the command-start marker plus some output, then
		// ends — exactly like a corrupted-marker run where the D (end) marker
		// and the global end event never show up.
		const stream = {
			async *[Symbol.asyncIterator]() {
				yield "\x1b]633;C\x07"
				yield "build output\n"
				// NOTE: intentionally no \x1b]633;D end marker.
			},
		}

		const mockTerminal = {
			shellIntegration: {
				executeCommand: vi.fn().mockReturnValue({
					read: vi.fn().mockReturnValue(stream),
				}),
				cwd: { fsPath: "/test/path" },
			},
			name: "Zoo Code",
			dispose: vi.fn(),
			hide: vi.fn(),
			show: vi.fn(),
			sendText: vi.fn(),
		}

		const mockTerminalInfo = new Terminal(1, mockTerminal as any, "/test/path")
		mockTerminalInfo.running = true

		const terminalProcess = new TerminalProcess(mockTerminalInfo)
		mockTerminalInfo.process = terminalProcess

		let completedOutput: string | undefined
		let continueEmitted = false
		terminalProcess.once("completed", (output) => {
			completedOutput = output
		})
		terminalProcess.once("continue", () => {
			continueEmitted = true
		})

		const runPromise = terminalProcess.run("npx vue-tsc -b")

		// Production path: TerminalRegistry emits stream_available from
		// onDidStartTerminalShellExecution (not via executeCommand().read()).
		terminalProcess.emit("stream_available", stream)
		terminalProcess.emit("shell_execution_started", 1234)

		// Let the stream drain (microtasks) and the post-stream code reach the
		// bounded await for shell_execution_complete.
		await vi.advanceTimersByTimeAsync(0)

		// The end event never fires; advance past the fallback window.
		await vi.advanceTimersByTimeAsync(5_000)

		await runPromise

		// run() completed instead of hanging.
		expect(continueEmitted).toBe(true)
		// Output captured from the stream is still surfaced.
		expect(completedOutput).toContain("build output")
		// Terminal bookkeeping was reset so the terminal can be reused.
		expect(mockTerminalInfo.busy).toBe(false)
		expect(mockTerminalInfo.running).toBe(false)
	})

	it("does not wait for the fallback when the end event arrives normally", async () => {
		vi.useFakeTimers()

		const stream = {
			async *[Symbol.asyncIterator]() {
				yield "\x1b]633;C\x07"
				yield "ok\n"
				yield "\x1b]633;D\x07"
			},
		}

		const mockTerminal = {
			shellIntegration: {
				executeCommand: vi.fn().mockReturnValue({
					read: vi.fn().mockReturnValue(stream),
				}),
				cwd: { fsPath: "/test/path" },
			},
			name: "Zoo Code",
			dispose: vi.fn(),
			hide: vi.fn(),
			show: vi.fn(),
			sendText: vi.fn(),
		}

		const mockTerminalInfo = new Terminal(2, mockTerminal as any, "/test/path")
		mockTerminalInfo.running = true

		const terminalProcess = new TerminalProcess(mockTerminalInfo)
		mockTerminalInfo.process = terminalProcess

		let continueEmitted = false
		terminalProcess.once("continue", () => {
			continueEmitted = true
		})

		const runPromise = terminalProcess.run("echo ok")
		terminalProcess.emit("stream_available", stream)
		terminalProcess.emit("shell_execution_started", 1234)

		// Drain the stream.
		await vi.advanceTimersByTimeAsync(0)

		// Deliver the completion signal the way TerminalRegistry would on the
		// real onDidEndTerminalShellExecution event.
		mockTerminalInfo.shellExecutionComplete({ exitCode: 0 })

		await vi.advanceTimersByTimeAsync(0)
		await runPromise

		expect(continueEmitted).toBe(true)
		expect(mockTerminalInfo.busy).toBe(false)
		expect(mockTerminalInfo.running).toBe(false)
	})
})
