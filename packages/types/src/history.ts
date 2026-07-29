import { z } from "zod"

/**
 * HistoryItem
 */

export const historyItemSchema = z.object({
	id: z.string(),
	rootTaskId: z.string().optional(),
	parentTaskId: z.string().optional(),
	number: z.number(),
	ts: z.number(),
	task: z.string(),
	tokensIn: z.number(),
	tokensOut: z.number(),
	cacheWrites: z.number().optional(),
	cacheReads: z.number().optional(),
	totalCost: z.number(),
	size: z.number().optional(),
	workspace: z.string().optional(),
	mode: z.string().optional(),
	apiConfigName: z.string().optional(), // Provider profile name for sticky profile feature
	status: z.enum(["active", "completed", "delegated", "interrupted"]).optional(),
	delegatedToId: z.string().optional(), // Legacy: last child this parent delegated to
	childIds: z.array(z.string()).optional(), // All children spawned by this task
	awaitingChildId: z.string().optional(), // Legacy: child awaited by the pre-serial delegation flow
	/** The only child currently authorized to write its completion result back to this parent. */
	callbackSubtaskId: z.string().optional(),
	completedByChildId: z.string().optional(), // Child that completed and resumed this parent
	completionResultSummary: z.string().optional(), // Summary from completed child
})

export type HistoryItem = z.infer<typeof historyItemSchema>
