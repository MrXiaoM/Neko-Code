// npx vitest run __tests__/provider-delegation.spec.ts

import { describe, it, expect, vi } from "vitest"
import type { HistoryItem } from "@roo-code/types"
import { RooCodeEventName } from "@roo-code/types"
import { ClineProvider } from "../core/webview/ClineProvider"

const parentHistoryItem: HistoryItem = {
	id: "parent-1",
	task: "Parent",
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	childIds: [],
} as unknown as HistoryItem

/** Minimal taskHistoryStore stub whose atomicReadAndUpdate calls the updater with the parent item. */
function makeStoreStub(
	overrides: Partial<{ atomicReadAndUpdate: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> }> = {},
) {
	return {
		atomicReadAndUpdate: vi.fn(async (_taskId: string, updater: (h: HistoryItem) => HistoryItem) => {
			updater(parentHistoryItem)
			return []
		}),
		get: vi.fn().mockReturnValue(undefined),
		...overrides,
	}
}

/**
 * Parent task double with the methods delegateParentAndOpenChild reads from
 * `parent`. Without flushPendingToolResultsToHistory the method hits its
 * non-fatal flush-error branch and never reaches the happy delegation path.
 */
const makeParentTask = () =>
	({
		taskId: "parent-1",
		emit: vi.fn(),
		flushPendingToolResultsToHistory: vi.fn().mockResolvedValue(true),
		retrySaveApiConversationHistory: vi.fn(),
	}) as any

describe("ClineProvider.delegateParentAndOpenChild()", () => {
	it("persists parent delegation metadata via atomicReadAndUpdate and emits TaskDelegated", async () => {
		const providerEmit = vi.fn()
		const parentTask = makeParentTask()

		const childStart = vi.fn()
		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const createTask = vi.fn().mockResolvedValue({ taskId: "child-1", start: childStart })
		const handleModeSwitch = vi.fn().mockResolvedValue(undefined)
		const taskHistoryStore = makeStoreStub()

		const provider = {
			emit: providerEmit,
			getCurrentTask: vi.fn(() => parentTask),
			removeClineFromStack,
			createTask,
			handleModeSwitch,
			log: vi.fn(),
			isViewLaunched: false,
			recentTasksCache: undefined,
			taskHistoryStore,
		} as unknown as ClineProvider

		const child = await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
		})

		expect(child.taskId).toBe("child-1")

		// Invariant: parent closed before child creation
		expect(removeClineFromStack).toHaveBeenCalledTimes(1)

		// Child task created with startTask: false and initialStatus: "active"
		expect(createTask).toHaveBeenCalledWith("Do something", undefined, parentTask, {
			initialTodos: [],
			initialStatus: "active",
			startTask: false,
		})

		// Delegation metadata written via atomicReadAndUpdate with correct taskId
		expect(taskHistoryStore.atomicReadAndUpdate).toHaveBeenCalledTimes(1)
		const [calledTaskId, updater] = taskHistoryStore.atomicReadAndUpdate.mock.calls[0]
		expect(calledTaskId).toBe("parent-1")

		// The updater must produce the correct delegation fields
		const result = updater(parentHistoryItem)
		expect(result).toMatchObject({
			id: "parent-1",
			status: "delegated",
			delegatedToId: "child-1",
			awaitingChildId: "child-1",
			childIds: expect.arrayContaining(["child-1"]),
		})

		// child.start() called AFTER parent metadata is persisted
		expect(childStart).toHaveBeenCalledTimes(1)

		// Provider-level event
		expect(providerEmit).toHaveBeenCalledWith(RooCodeEventName.TaskDelegated, "parent-1", "child-1")

		// Mode switch
		expect(handleModeSwitch).toHaveBeenCalledWith("code")
	})

	it("posts taskHistoryItemUpdated to the webview when isViewLaunched is true", async () => {
		const updatedParent = { ...parentHistoryItem, status: "delegated" } as HistoryItem
		const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const parentTask = makeParentTask()
		const taskHistoryStore = makeStoreStub({
			get: vi.fn().mockReturnValue(updatedParent),
		})

		const provider = {
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => parentTask),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask: vi.fn().mockResolvedValue({ taskId: "child-1", start: vi.fn() }),
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview,
			log: vi.fn(),
			isViewLaunched: true,
			recentTasksCache: undefined,
			taskHistoryStore,
		} as unknown as ClineProvider

		await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
		})

		expect(postMessageToWebview).toHaveBeenCalledWith({
			type: "taskHistoryItemUpdated",
			taskHistoryItem: updatedParent,
		})
	})

	it("skips postMessageToWebview when isViewLaunched is true but store returns undefined", async () => {
		const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const parentTask = makeParentTask()
		const taskHistoryStore = makeStoreStub({
			get: vi.fn().mockReturnValue(undefined),
		})

		const provider = {
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => parentTask),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask: vi.fn().mockResolvedValue({ taskId: "child-1", start: vi.fn() }),
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview,
			log: vi.fn(),
			isViewLaunched: true,
			recentTasksCache: undefined,
			taskHistoryStore,
		} as unknown as ClineProvider

		await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
		})

		expect(postMessageToWebview).not.toHaveBeenCalled()
	})

	it("calls child.start() only after atomicReadAndUpdate completes (no race condition)", async () => {
		const callOrder: string[] = []

		const parentTask = makeParentTask()
		const childStart = vi.fn(() => callOrder.push("child.start"))
		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const createTask = vi.fn(async () => {
			callOrder.push("createTask")
			return { taskId: "child-1", start: childStart }
		})
		const handleModeSwitch = vi.fn().mockResolvedValue(undefined)
		const taskHistoryStore = makeStoreStub({
			atomicReadAndUpdate: vi.fn(async (_taskId: string, _updater: (h: HistoryItem) => HistoryItem) => {
				callOrder.push("atomicReadAndUpdate")
				return []
			}),
		})

		const provider = {
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => parentTask),
			removeClineFromStack,
			createTask,
			handleModeSwitch,
			log: vi.fn(),
			isViewLaunched: false,
			recentTasksCache: undefined,
			taskHistoryStore,
		} as unknown as ClineProvider

		await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
		})

		// createTask → atomicReadAndUpdate → child.start: lock must release before start
		expect(callOrder).toEqual(["createTask", "atomicReadAndUpdate", "child.start"])
	})

	it("rolls back the paused child and restores the parent when atomicReadAndUpdate fails", async () => {
		const persistError = new Error("parent metadata persist failed")
		const parentTask = makeParentTask()
		const childStart = vi.fn()
		const removeClineFromStack = vi.fn().mockResolvedValue(undefined)
		const deleteTaskWithId = vi.fn().mockResolvedValue(undefined)
		const createTaskWithHistoryItem = vi.fn().mockResolvedValue(undefined)
		const getTaskWithId = vi.fn().mockResolvedValue({ historyItem: parentHistoryItem })

		const taskHistoryStore = makeStoreStub({
			atomicReadAndUpdate: vi.fn().mockRejectedValue(persistError),
		})

		const child = { taskId: "child-1", start: childStart }
		// Before createTask: getCurrentTask returns parent (used by step 3 close).
		// After createTask: returns child so the rollback guard passes and the child is popped.
		const getCurrentTask = vi.fn().mockReturnValue(parentTask)
		const createTask = vi.fn().mockImplementation(async () => {
			getCurrentTask.mockReturnValue(child)
			return child
		})

		const provider = {
			emit: vi.fn(),
			getCurrentTask,
			removeClineFromStack,
			createTask,
			getTaskWithId,
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			deleteTaskWithId,
			createTaskWithHistoryItem,
			log: vi.fn(),
			isViewLaunched: false,
			recentTasksCache: undefined,
			taskHistoryStore,
		} as unknown as ClineProvider

		await expect(
			(ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
				parentTaskId: "parent-1",
				message: "Do something",
				initialTodos: [],
				mode: "code",
			}),
		).rejects.toThrow(persistError)

		expect(childStart).not.toHaveBeenCalled()
		expect(removeClineFromStack).toHaveBeenNthCalledWith(1, { skipDelegationRepair: true })
		expect(removeClineFromStack).toHaveBeenNthCalledWith(2, { skipDelegationRepair: true })
		expect(deleteTaskWithId).toHaveBeenCalledWith("child-1", false)
		expect(createTaskWithHistoryItem).toHaveBeenCalledWith(parentHistoryItem)
	})

	it("re-delegates when parent is already delegated (interrupted child → new child)", async () => {
		// Regression: after user returns from an interrupted child, parent may still be
		// "delegated". Re-delegation must repoint awaitingChildId without assertValidTransition
		// delegated → delegated, and must start the new child (no flash-back rollback).
		const parentTask = makeParentTask()
		const childStart = vi.fn()
		const updateTaskHistory = vi.fn().mockResolvedValue([])
		const delegatedParent: HistoryItem = {
			...parentHistoryItem,
			status: "delegated",
			awaitingChildId: "old-child",
			delegatedToId: "old-child",
			childIds: ["old-child"],
		} as HistoryItem
		const oldChildActive: HistoryItem = {
			id: "old-child",
			task: "Old child",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			status: "active",
		} as HistoryItem

		const taskHistoryStore = makeStoreStub({
			atomicReadAndUpdate: vi.fn(async (_taskId: string, updater: (h: HistoryItem) => HistoryItem) => {
				updater(delegatedParent)
				return []
			}),
			get: vi.fn((id: string) => {
				if (id === "old-child") return oldChildActive
				if (id === "parent-1") {
					return {
						...delegatedParent,
						awaitingChildId: "child-2",
						delegatedToId: "child-2",
						childIds: ["old-child", "child-2"],
					}
				}
				return undefined
			}),
		})

		const provider = {
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => parentTask),
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask: vi.fn().mockResolvedValue({ taskId: "child-2", start: childStart }),
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			updateTaskHistory,
			log: vi.fn(),
			isViewLaunched: false,
			recentTasksCache: undefined,
			taskHistoryStore,
		} as unknown as ClineProvider

		const child = await (ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
			parentTaskId: "parent-1",
			message: "Do something else",
			initialTodos: [],
			mode: "code",
		})

		expect(child.taskId).toBe("child-2")
		expect(childStart).toHaveBeenCalledTimes(1)

		const [, updater] = taskHistoryStore.atomicReadAndUpdate.mock.calls[0]
		const result = updater(delegatedParent)
		expect(result).toMatchObject({
			id: "parent-1",
			status: "delegated",
			delegatedToId: "child-2",
			awaitingChildId: "child-2",
			childIds: expect.arrayContaining(["old-child", "child-2"]),
		})
		// Must not throw: same-status re-delegation (no assertValidTransition for delegated→delegated)

		// Previous active child is superseded to interrupted
		expect(updateTaskHistory).toHaveBeenCalledWith(
			expect.objectContaining({ id: "old-child", status: "interrupted" }),
		)
	})

	it("throws when parent status cannot be delegated (e.g. completed)", async () => {
		const parentTask = makeParentTask()
		const childStart = vi.fn()
		const completedParent: HistoryItem = {
			...parentHistoryItem,
			status: "completed",
		} as HistoryItem

		const getCurrentTask = vi.fn().mockReturnValue(parentTask)
		const createTask = vi.fn().mockImplementation(async () => {
			const child = { taskId: "child-x", start: childStart }
			getCurrentTask.mockReturnValue(child)
			return child
		})

		const taskHistoryStore = makeStoreStub({
			atomicReadAndUpdate: vi.fn(async (_taskId: string, updater: (h: HistoryItem) => HistoryItem) => {
				updater(completedParent)
				return []
			}),
		})

		const provider = {
			emit: vi.fn(),
			getCurrentTask,
			removeClineFromStack: vi.fn().mockResolvedValue(undefined),
			createTask,
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			deleteTaskWithId: vi.fn().mockResolvedValue(undefined),
			getTaskWithId: vi.fn().mockResolvedValue({ historyItem: completedParent }),
			createTaskWithHistoryItem: vi.fn().mockResolvedValue(undefined),
			log: vi.fn(),
			isViewLaunched: false,
			recentTasksCache: undefined,
			taskHistoryStore,
		} as unknown as ClineProvider

		await expect(
			(ClineProvider.prototype as any).delegateParentAndOpenChild.call(provider, {
				parentTaskId: "parent-1",
				message: "Nope",
				initialTodos: [],
				mode: "code",
			}),
		).rejects.toThrow(/invalid status "completed"/)

		expect(childStart).not.toHaveBeenCalled()
	})
})

describe("ClineProvider.takeOverParentIfReturningFromChild / showTaskWithId", () => {
	/** Bind prototype methods onto a plain mock so `this.method` works like a real instance. */
	function withPrototypeMethods(provider: Record<string, any>) {
		provider.showTaskWithId = (ClineProvider.prototype as any).showTaskWithId
		provider.takeOverParentIfReturningFromChild = (
			ClineProvider.prototype as any
		).takeOverParentIfReturningFromChild
		return provider as unknown as ClineProvider
	}

	it("clears parent delegation when navigating from child back to parent", async () => {
		const childTask = {
			taskId: "child-1",
			parentTaskId: "parent-1",
		}
		const parentHistory: HistoryItem = {
			id: "parent-1",
			task: "Parent",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			status: "delegated",
			awaitingChildId: "child-1",
			delegatedToId: "child-1",
			childIds: ["child-1"],
		} as HistoryItem
		const childHistory: HistoryItem = {
			id: "child-1",
			task: "Child",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			status: "active",
			parentTaskId: "parent-1",
		} as HistoryItem

		const updateTaskHistory = vi.fn().mockResolvedValue([])
		const createTaskWithHistoryItem = vi.fn().mockResolvedValue(undefined)
		const postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		const cancelledDelegationChildIds = new Set<string>(["child-1"])

		const provider = withPrototypeMethods({
			getCurrentTask: vi.fn(() => childTask),
			getTaskWithId: vi.fn(async (id: string) => {
				if (id === "parent-1") return { historyItem: { ...parentHistory } }
				throw new Error("not found")
			}),
			createTaskWithHistoryItem,
			postMessageToWebview,
			updateTaskHistory,
			log: vi.fn(),
			taskHistoryStore: {
				get: vi.fn((id: string) => (id === "child-1" ? childHistory : undefined)),
			},
			cancelledDelegationChildIds,
			runDelegationTransition: vi.fn(async (_id: string, fn: () => Promise<void>) => fn()),
		})

		await (provider as any).showTaskWithId("parent-1")

		expect(updateTaskHistory).toHaveBeenCalledWith(
			expect.objectContaining({ id: "child-1", status: "interrupted" }),
		)
		expect(updateTaskHistory).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "parent-1",
				status: "active",
				awaitingChildId: undefined,
				delegatedToId: undefined,
			}),
		)
		expect(cancelledDelegationChildIds.has("child-1")).toBe(false)
		expect(createTaskWithHistoryItem).toHaveBeenCalledWith(expect.objectContaining({ id: "parent-1" }))
		expect(postMessageToWebview).toHaveBeenCalledWith({ type: "action", action: "chatButtonClicked" })
	})

	it("does not clear delegation when opening an unrelated task", async () => {
		const childTask = {
			taskId: "child-1",
			parentTaskId: "parent-1",
		}
		const updateTaskHistory = vi.fn().mockResolvedValue([])
		const otherHistory: HistoryItem = {
			id: "other-task",
			task: "Other",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			status: "active",
		} as HistoryItem

		const provider = withPrototypeMethods({
			getCurrentTask: vi.fn(() => childTask),
			getTaskWithId: vi.fn(async () => ({ historyItem: otherHistory })),
			createTaskWithHistoryItem: vi.fn().mockResolvedValue(undefined),
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
			updateTaskHistory,
			log: vi.fn(),
			taskHistoryStore: { get: vi.fn() },
			cancelledDelegationChildIds: new Set<string>(),
			runDelegationTransition: vi.fn(async (_id: string, fn: () => Promise<void>) => fn()),
		})

		await (provider as any).showTaskWithId("other-task")

		expect(updateTaskHistory).not.toHaveBeenCalled()
		expect(provider.createTaskWithHistoryItem).toHaveBeenCalledWith(otherHistory)
	})
})
