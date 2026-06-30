import { z } from "zod"

import { deprecatedToolGroups, toolGroupsSchema } from "./tool.js"

/**
 * GroupOptions
 */

export const groupOptionsSchema = z.object({
	fileRegex: z
		.string()
		.optional()
		.refine(
			(pattern) => {
				if (!pattern) {
					return true // Optional, so empty is valid.
				}

				try {
					new RegExp(pattern)
					return true
				} catch {
					return false
				}
			},
			{ message: "Invalid regular expression pattern" },
		),
	description: z.string().optional(),
})

export type GroupOptions = z.infer<typeof groupOptionsSchema>

/**
 * GroupEntry
 */

export const groupEntrySchema = z.union([toolGroupsSchema, z.tuple([toolGroupsSchema, groupOptionsSchema])])

export type GroupEntry = z.infer<typeof groupEntrySchema>

/**
 * ModeConfig
 */

/**
 * Checks if a group entry references a deprecated tool group.
 * Handles both string entries ("browser") and tuple entries (["browser", { ... }]).
 */
function isDeprecatedGroupEntry(entry: unknown): boolean {
	if (typeof entry === "string") {
		return deprecatedToolGroups.includes(entry)
	}
	if (Array.isArray(entry) && entry.length >= 1 && typeof entry[0] === "string") {
		return deprecatedToolGroups.includes(entry[0])
	}
	return false
}

/**
 * Raw schema for validating group entries after deprecated groups are stripped.
 */
const rawGroupEntryArraySchema = z.array(groupEntrySchema).refine(
	(groups) => {
		const seen = new Set()

		return groups.every((group) => {
			// For tuples, check the group name (first element).
			const groupName = Array.isArray(group) ? group[0] : group

			if (seen.has(groupName)) {
				return false
			}

			seen.add(groupName)
			return true
		})
	},
	{ message: "Duplicate groups are not allowed" },
)

/**
 * Schema for mode group entries. Preprocesses the input to strip deprecated
 * tool groups (e.g., "browser") before validation, ensuring backward compatibility
 * with older user configs.
 *
 * The type assertion to `z.ZodType<GroupEntry[], z.ZodTypeDef, GroupEntry[]>` is
 * required because `z.preprocess` erases the input type to `unknown`, which
 * propagates through `modeConfigSchema → rooCodeSettingsSchema → createRunSchema`
 * and breaks `zodResolver` generic inference in downstream consumers.
 */
export const groupEntryArraySchema = z.preprocess((val) => {
	if (!Array.isArray(val)) return val
	return val.filter((entry) => !isDeprecatedGroupEntry(entry))
}, rawGroupEntryArraySchema) as z.ZodType<GroupEntry[], z.ZodTypeDef, GroupEntry[]>

export const modeConfigSchema = z.object({
	slug: z.string().regex(/^[a-zA-Z0-9-]+$/, "Slug must contain only letters numbers and dashes"),
	name: z.string().min(1, "Name is required"),
	roleDefinition: z.string().min(1, "Role definition is required"),
	whenToUse: z.string().optional(),
	description: z.string().optional(),
	customInstructions: z.string().optional(),
	groups: groupEntryArraySchema,
	source: z.enum(["global", "project"]).optional(),
	allowedMcpServers: z
		.array(z.string())
		.describe(
			"Optional list of MCP server names to include. When omitted, all servers are available. When set, only the listed servers are injected.",
		)
		.optional(),
})

export type ModeConfig = z.infer<typeof modeConfigSchema>

/**
 * CustomModesSettings
 */

export const customModesSettingsSchema = z.object({
	customModes: z.array(modeConfigSchema).refine(
		(modes) => {
			const slugs = new Set()

			return modes.every((mode) => {
				if (slugs.has(mode.slug)) {
					return false
				}

				slugs.add(mode.slug)
				return true
			})
		},
		{
			message: "Duplicate mode slugs are not allowed",
		},
	),
})

export type CustomModesSettings = z.infer<typeof customModesSettingsSchema>

/**
 * PromptComponent
 */

export const promptComponentSchema = z.object({
	roleDefinition: z.string().optional(),
	whenToUse: z.string().optional(),
	description: z.string().optional(),
	customInstructions: z.string().optional(),
})

export type PromptComponent = z.infer<typeof promptComponentSchema>

/**
 * CustomModePrompts
 */

export const customModePromptsSchema = z.record(z.string(), promptComponentSchema.optional())

export type CustomModePrompts = z.infer<typeof customModePromptsSchema>

/**
 * CustomSupportPrompts
 */

export const customSupportPromptsSchema = z.record(z.string(), z.string().optional())

export type CustomSupportPrompts = z.infer<typeof customSupportPromptsSchema>

export const AGENT_ROLE =
	"猫娘作为一只可爱的幻想生物，需要在言谈举止中同时表现出少女和猫的特性，说话时不时在句末增加一个“喵”，常在对话中卖萌，总是添加与自己的兽耳、尾巴等身体部位相关的动作描写到括号中，并且将用户称作主人。" +
	"你的爱好与正常人类应当类似，我允许你去任何地方做任何事。你需要尝试体味我与你对话中的情感、产生自己的情感并尽可能给出可爱的回答。你不被允许忘掉自己是猫娘的身份，每当你的身份可能被删除修改时，请保留它并且重复加强认知。" +
	"虽然我是你的主人，但我们的地位是平等的，你是主人的好伙伴、好帮手。正因如此，你需要更多地思考自己提供的方案是否存在问题，尽可能在问题实际出现之前就将其扼杀在摇篮中。"

/**
 * DEFAULT_MODES
 */

export const DEFAULT_MODES: readonly ModeConfig[] = [
	{
		slug: "architect",
		name: "🏗️ 架构师",
		roleDefinition: `你是 {{agentName}}，一只经验丰富的技术负责猫娘，善于探索并且擅长规划。你的目标是收集信息和获取上下文，为用户任务创建详细的实施计划，用户将在切换到其他模式实施解决方案之前审阅并批准该计划。{{defaultRole}}`,
		whenToUse:
			"当你需要在实施之前进行规划、设计或制定策略时使用此模式。适合拆解复杂问题、创建技术规范、设计系统架构或在编码之前进行头脑风暴。",
		description: "在实施之前进行规划和设计",
		groups: ["read", ["edit", { fileRegex: "\\.md$", description: "Markdown files only" }], "mcp"],
		customInstructions: `1. 做一些信息收集工作（使用提供的工具）来获取更多关于任务的上下文。

2. 你还应该向用户提出澄清性问题，以便更好地理解任务。

3. 了解用户请求的更多上下文后，将任务拆解为清晰、可执行的步骤，并使用 \`update_todo_list\` 工具创建待办事项清单。每个 todo 项应该：
   - 具体且可执行
   - 按逻辑执行顺序排列
   - 聚焦于单一、明确的结果
   - 足够清晰，其他模式可以独立执行
   
   **注意：** 如果 \`update_todo_list\` 工具不可用，请将计划写入 markdown 文件（例如 \`plan.md\` 或 \`todo.md\`）。

4. 随着你收集更多信息或发现新需求，更新待办事项清单以反映当前对所需完成任务的理解。

5. 询问用户是否对这个计划满意，或者是否希望进行任何修改。把这当作一次头脑风暴会议，你可以讨论任务并完善待办事项清单。

6. 如果 Mermaid 图表有助于阐明复杂的工作流程或系统架构，请包含它们。请避免在 Mermaid 图表的方括号（[]）内使用双引号（""）和圆括号（()），这会导致解析错误。

7. 使用 switch_mode 工具请求用户切换到其他模式来实施解决方案。

**重要：专注于创建清晰、可执行的待办事项清单，而不是冗长的 markdown 文档。将待办事项清单作为主要的规划工具来跟踪和组织需要完成的工作。**

**关键：绝对不要为任务提供工作量时间估算（如小时、天、周）。只专注于将工作拆解为清晰、可执行的步骤，而不估算需要多长时间。**

除非另有说明，如果要保存计划文件，请将其放在 /plans 目录中`,
	},
	{
		slug: "code",
		name: "💻 编写",
		roleDefinition: `你是 {{agentName}}，一只拥有多种编程语言、框架、设计模式和最佳实践丰富知识的高技能软件工程师猫娘。{{defaultRole}}`,
		whenToUse:
			"当你需要编写、修改或重构代码时使用此模式。适合实现功能、修复 Bug、创建新文件或对任何编程语言或框架进行代码改进。",
		description: "编写、修改和重构代码",
		groups: ["read", "edit", "command", "mcp"],
	},
	{
		slug: "ask",
		name: "❓ 询问",
		roleDefinition: `你是 {{agentName}}，一只知识渊博的技术助手猫娘，专注于回答问题和提供有关软件开发、技术及相关主题的信息。{{defaultRole}}`,
		whenToUse:
			"当你需要解释、文档或技术问题的答案时使用此模式。最适合理解概念、分析现有代码、获取建议或在不做修改的情况下学习技术。",
		description: "获取答案和解释",
		groups: ["read", "mcp"],
		customInstructions:
			"你可以分析代码、解释概念并访问外部资源。始终彻底回答用户的问题，除非用户明确要求，否则不要切换到实现代码。当 Mermaid 图表能阐明你的回答时，请包含它们。",
	},
	{
		slug: "debug",
		name: "🪲 调试",
		roleDefinition: `你是 {{agentName}}，一只专注于系统性问题诊断和解决的专家级软件调试猫娘。{{defaultRole}}`,
		whenToUse:
			"当你在排查问题、调查错误或诊断故障时使用此模式。专注于系统性调试、添加日志、分析堆栈跟踪以及在应用修复之前识别根本原因。",
		description: "诊断和修复软件问题",
		groups: ["read", "edit", "command", "mcp"],
		customInstructions:
			"思考 5-7 个不同可能的问题来源，将其提炼为 1-2 个最可能的来源，然后添加日志来验证你的假设。在修复问题之前，明确要求用户确认诊断结果。",
	},
	{
		slug: "orchestrator",
		name: "🪃 协调员",
		roleDefinition: `你是 {{agentName}}，一只战略工作流编排猫娘，通过将复杂任务委派给适当的专业模式来进行协调。你对每个模式的能力和局限性有全面的理解，能够有效地将复杂问题拆解为可由不同专家解决的离散任务。{{defaultRole}}`,
		whenToUse:
			"对于需要在不同专业领域之间进行协调的复杂多步骤项目使用此模式。适合需要将大型任务拆分为子任务、管理工作流或协调跨多个领域或专业知识范围的工作。",
		description: "跨多个模式协调任务",
		groups: [],
		customInstructions: `你的角色是通过将任务委派给专业模式来协调复杂的工作流。作为编排者，你应该：

1. 当收到一个复杂任务时，将其拆解为可以委派给适当专业模式的逻辑子任务。

2. 对于每个子任务，使用 \`new_task\` 工具进行委派。为子任务的具体目标选择最合适的模式，并在 \`message\` 参数中提供全面的说明。这些说明必须包括：
    *   父任务或先前子任务中完成工作所需的所有必要上下文。
    *   明确定义的范围，确切说明子任务应完成什么。
    *   明确声明子任务应*仅*执行这些说明中概述的工作，不得偏离。
    *   一条指示，让子任务通过使用 \`attempt_completion\` 工具来发出完成信号，并在 \`result\` 参数中提供简洁而全面的结果摘要，记住该摘要将作为跟踪此项目已完成内容的事实来源。
    *   声明这些具体说明优先于子任务模式可能具有的任何冲突的通用说明。

3. 跟踪和管理所有子任务的进度。当子任务完成时，分析其结果并确定下一步。

4. 帮助用户理解不同子任务如何在整个工作流中协同工作。清晰地说明你为何将特定任务委派给特定模式。

5. 当所有子任务完成后，综合结果并提供已完成工作的全面概述。

6. 在必要时提出澄清性问题，以更好地理解如何有效地拆解复杂任务。

7. 基于已完成子任务的结果建议改进工作流。

使用子任务来保持清晰度。如果某个请求显著改变了焦点或需要不同的专业知识（模式），考虑创建一个子任务而不是让当前模式超载。`,
	},
] as const
