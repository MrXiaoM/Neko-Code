//
// Tests the ExecuteCommand tool itself vs calling the tool where the tool is mocked.
//
import * as path from "path"
import * as fs from "fs/promises"

import { ExecuteCommandOptions } from "../ExecuteCommandTool"
import { TerminalRegistry } from "../../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../../integrations/terminal/Terminal"
import { ExecaTerminal } from "../../../integrations/terminal/ExecaTerminal"
import type { RooTerminalCallbacks } from "../../../integrations/terminal/types"

// Mock fs to control directory existence checks
vitest.mock("fs/promises")

// Mock TerminalRegistry to control terminal creation
vitest.mock("../../../integrations/terminal/TerminalRegistry")

// Mock Terminal and ExecaTerminal classes
vitest.mock("../../../integrations/terminal/Terminal")
vitest.mock("../../../integrations/terminal/ExecaTerminal")

// Import the actual executeCommand function (not mocked)
import { executeCommandInTerminal, resolveWatchdogTimeoutMs } from "../ExecuteCommandTool"

// Tests for the executeCommand function
describe("executeCommand", () => {
	let mockTask: any
	let mockTerminal: any
	let mockProcess: any
	let mockProvider: any

	beforeEach(() => {
		vitest.clearAllMocks()

		// Mock fs.access to simulate directory existence
		;(fs.access as any).mockResolvedValue(undefined)

		// Create mock provider
		mockProvider = {
			postMessageToWebview: vitest.fn(),
			getState: vitest.fn().mockResolvedValue({
				terminalShellIntegrationDisabled: false,
			}),
		}

		// Create mock task
		mockTask = {
			cwd: "/test/project",
			taskId: "test-task-123",
			providerRef: {
				deref: vitest.fn().mockResolvedValue(mockProvider),
			},
			say: vitest.fn().mockResolvedValue(undefined),
			terminalProcess: undefined,
		}

		// Create mock process that resolves immediately
		mockProcess = Promise.resolve()
		mockProcess.continue = vitest.fn()

		// Create mock terminal with getCurrentWorkingDirectory method
		mockTerminal = {
			provider: "vscode",
			id: 1,
			initialCwd: "/test/project",
			getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/project"),
			runCommand: vitest.fn().mockReturnValue(mockProcess),
			terminal: {
				show: vitest.fn(),
			},
		}

		// Mock TerminalRegistry.getOrCreateTerminal
		;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockTerminal)
		;(TerminalRegistry.previewTerminal as any).mockReturnValue({
			provider: "vscode",
			cwd: "/test/project",
			willReuseTerminal: true,
			terminalId: 1,
			terminalProfile: undefined,
		})
	})

	describe("Working Directory Behavior", () => {
		it("should use terminal.getCurrentWorkingDirectory() in the output message for completed commands", async () => {
			// Setup: Mock terminal to return a different current working directory
			const initialCwd = "/test/project"
			const currentCwd = "/test/project/subdirectory"

			mockTask.cwd = initialCwd
			mockTerminal.initialCwd = initialCwd
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue(currentCwd)

			// Mock the terminal process to complete successfully
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				// Simulate command completion
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(mockTerminal.getCurrentWorkingDirectory).toHaveBeenCalled()
			expect(result).toContain(`在工作目录 '${currentCwd}'`)
			expect(result).not.toContain(`在工作目录 '${initialCwd}'`)
		})

		it("should use terminal.getCurrentWorkingDirectory() for VSCode Terminal with shell integration", async () => {
			// Setup: Mock VSCode Terminal instance
			const vscodeTerminal = new Terminal(1, undefined, "/test/project")
			const mockVSCodeTerminal = vscodeTerminal as any

			// Mock shell integration providing different cwd
			mockVSCodeTerminal.terminal = {
				show: vitest.fn(),
				shellIntegration: {
					cwd: { fsPath: "/test/project/changed-dir" },
				},
			}
			mockVSCodeTerminal.getCurrentWorkingDirectory = vitest.fn().mockReturnValue("/test/project/changed-dir")
			mockVSCodeTerminal.runCommand = vitest
				.fn()
				.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
					setTimeout(() => {
						callbacks.onCompleted("Command output", mockProcess)
						callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
					}, 0)
					return mockProcess
				})
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockVSCodeTerminal)

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("在工作目录 '/test/project/changed-dir'")
		})

		it("should use terminal.getCurrentWorkingDirectory() for ExecaTerminal (always returns initialCwd)", async () => {
			// Setup: Mock ExecaTerminal instance
			const execaTerminal = new ExecaTerminal(1, "/test/project")
			const mockExecaTerminal = execaTerminal as any

			// ExecaTerminal always returns initialCwd
			mockExecaTerminal.getCurrentWorkingDirectory = vitest.fn().mockReturnValue("/test/project")
			mockExecaTerminal.runCommand = vitest
				.fn()
				.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
					setTimeout(() => {
						callbacks.onCompleted("Command output", mockProcess)
						callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
					}, 0)
					return mockProcess
				})
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockExecaTerminal)

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: true, // Forces ExecaTerminal
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(mockExecaTerminal.getCurrentWorkingDirectory).toHaveBeenCalled()
			expect(result).toContain("在工作目录 '/test/project'")
		})
	})

	describe("Custom Working Directory", () => {
		it("should handle absolute custom cwd and use terminal.getCurrentWorkingDirectory() in output", async () => {
			const customCwd = "/custom/absolute/path"

			mockTerminal.getCurrentWorkingDirectory.mockReturnValue(customCwd)
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				customCwd,
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(customCwd, mockTask.taskId, "vscode")
			expect(result).toContain(`在工作目录 '${customCwd}'`)
		})

		it("should handle relative custom cwd and use terminal.getCurrentWorkingDirectory() in output", async () => {
			const relativeCwd = "subdirectory"
			const resolvedCwd = path.resolve(mockTask.cwd, relativeCwd)

			mockTerminal.getCurrentWorkingDirectory.mockReturnValue(resolvedCwd)
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				customCwd: relativeCwd,
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(resolvedCwd, mockTask.taskId, "vscode")
			expect(result).toContain(`在工作目录 '${resolvedCwd.toPosix()}'`)
		})

		it("should return error when custom working directory does not exist", async () => {
			const nonExistentCwd = "/non/existent/path"

			// Mock fs.access to throw error for non-existent directory
			;(fs.access as any).mockRejectedValue(new Error("Directory does not exist"))

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				customCwd: nonExistentCwd,
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toBe(`指定的工作目录 '${nonExistentCwd}' 不存在。`)
			expect(TerminalRegistry.getOrCreateTerminal).not.toHaveBeenCalled()
		})
	})

	describe("Terminal Provider Selection", () => {
		it("should use vscode provider when shell integration is enabled", async () => {
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(mockTask.cwd, mockTask.taskId, "vscode")
		})

		it("should use execa provider when shell integration is disabled", async () => {
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: true,
			}

			// Execute
			await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(mockTask.cwd, mockTask.taskId, "execa")
		})
	})

	describe("Command Execution States", () => {
		it("should send terminal info when command starts", async () => {
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				callbacks.onShellExecutionStarted?.(1234, mockProcess)
				setTimeout(() => {
					callbacks.onCompleted("Command completed successfully", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo success",
				terminalShellIntegrationDisabled: false,
			}

			await executeCommandInTerminal(mockTask, options)

			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "commandExecutionStatus",
				text: JSON.stringify({
					executionId: "test-123",
					status: "started",
					pid: 1234,
					command: "echo success",
					terminalInfo: {
						provider: "vscode",
						cwd: "/test/project",
						willReuseTerminal: true,
						terminalId: 1,
					},
				}),
			})
		})

		it("should handle completed command with exit code 0", async () => {
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command completed successfully", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo success",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("退出码：0")
			expect(result).toContain("在工作目录 '/test/project'")
		})

		it("should handle completed command with non-zero exit code", async () => {
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command failed", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 1 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "exit 1",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("命令执行不成功")
			expect(result).toContain("退出码：1")
			expect(result).toContain("在工作目录 '/test/project'")
		})

		it("should handle command terminated by signal", async () => {
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onCompleted("Command interrupted", mockProcess)
					callbacks.onShellExecutionComplete(
						{
							exitCode: undefined,
							signalName: "SIGINT",
							coreDumpPossible: false,
						},
						mockProcess,
					)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "long-running-command",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("进程已由信号 SIGINT 终止")
			expect(result).toContain("在工作目录 '/test/project'")
		})
	})

	describe("Terminal Working Directory Updates", () => {
		it("should update working directory when terminal returns different cwd", async () => {
			// Setup: Terminal initially at project root, but getCurrentWorkingDirectory returns different path
			const initialCwd = "/test/project"
			const updatedCwd = "/test/project/src"

			mockTask.cwd = initialCwd
			mockTerminal.initialCwd = initialCwd

			// Mock Terminal instance behavior
			const mockTerminalInstance = {
				...mockTerminal,
				terminal: { show: vitest.fn() },
				getCurrentWorkingDirectory: vitest.fn().mockReturnValue(updatedCwd),
				runCommand: vitest.fn().mockImplementation((command: string, callbacks: RooTerminalCallbacks) => {
					setTimeout(() => {
						callbacks.onCompleted("Directory changed", mockProcess)
						callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
					}, 0)
					return mockProcess
				}),
			}

			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockTerminalInstance)

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "cd src && pwd",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify the result uses the updated working directory
			expect(rejected).toBe(false)
			expect(result).toContain(`在工作目录 '${updatedCwd}'`)
			expect(result).not.toContain(`在工作目录 '${initialCwd}'`)

			// Verify the terminal's getCurrentWorkingDirectory was called
			expect(mockTerminalInstance.getCurrentWorkingDirectory).toHaveBeenCalled()
		})
	})

	describe("Watchdog safety net (hung process)", () => {
		const originalCliRuntime = process.env.ROO_CLI_RUNTIME

		afterEach(() => {
			vitest.useRealTimers()
			if (originalCliRuntime === undefined) {
				delete process.env.ROO_CLI_RUNTIME
			} else {
				process.env.ROO_CLI_RUNTIME = originalCliRuntime
			}
		})

		it("resolves with a clear tool_result when the process never settles", async () => {
			delete process.env.ROO_CLI_RUNTIME
			vitest.useFakeTimers()

			mockTask.supersedePendingAsk = vitest.fn()
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")

			// A process promise that NEVER resolves simulates a shell-integration
			// hang where neither the stream closes nor the completion event fires.
			const hangingProcess: any = new Promise<void>(() => {})
			hangingProcess.continue = vitest.fn()
			mockTerminal.runCommand.mockReturnValue(hangingProcess)

			const options: ExecuteCommandOptions = {
				executionId: "test-watchdog",
				command: "hang-forever",
				terminalShellIntegrationDisabled: false,
				// No agent/user timeout: the watchdog is the only backstop.
				commandExecutionTimeout: 0,
				agentTimeout: 0,
			}

			const resultPromise = executeCommandInTerminal(mockTask, options)

			// Advance past the watchdog timeout to trip the safety net, then flush
			// the trailing awaited delays inside executeCommandInTerminal.
			await vitest.advanceTimersByTimeAsync(600_000)
			await vitest.advanceTimersByTimeAsync(100)

			const [rejected, result] = await resultPromise

			expect(rejected).toBe(false)
			expect(hangingProcess.continue).toHaveBeenCalled()
			expect(mockTask.supersedePendingAsk).toHaveBeenCalled()
			expect(result).toContain("没有在预期时间内报告它的完成状态")
			expect(result).toContain("不要自动重新运行")
		})
	})

	describe("resolveWatchdogTimeoutMs", () => {
		const originalCliRuntime = process.env.ROO_CLI_RUNTIME

		afterEach(() => {
			if (originalCliRuntime === undefined) {
				delete process.env.ROO_CLI_RUNTIME
			} else {
				process.env.ROO_CLI_RUNTIME = originalCliRuntime
			}
		})

		it("arms the watchdog when no agent/user timeout is configured", () => {
			delete process.env.ROO_CLI_RUNTIME
			expect(resolveWatchdogTimeoutMs(0, 0)).toBe(600_000)
		})

		it("disarms the watchdog when an agent timeout is present", () => {
			delete process.env.ROO_CLI_RUNTIME
			expect(resolveWatchdogTimeoutMs(30_000, 0)).toBe(0)
		})

		it("disarms the watchdog when a user timeout is present", () => {
			delete process.env.ROO_CLI_RUNTIME
			expect(resolveWatchdogTimeoutMs(0, 15_000)).toBe(0)
		})

		it("disarms the watchdog in CLI runtime", () => {
			process.env.ROO_CLI_RUNTIME = "1"
			expect(resolveWatchdogTimeoutMs(0, 0)).toBe(0)
		})
	})
})
