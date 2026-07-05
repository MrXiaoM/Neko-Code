import { McpHub } from "../../../services/mcp/McpHub"

/**
 * Builds the CAPABILITIES section of the system prompt.
 *
 * The MCP availability line is only emitted when at least one MCP server is actually
 * exposed to the current mode. When `allowedMcpServers` is provided, the hub's server
 * list is filtered by that allowlist BEFORE deciding whether to advertise MCP, so the
 * capability text matches the per-mode tool exposure:
 *   - `undefined` allowlist  → all connected servers count (backward compatible)
 *   - empty `[]` allowlist   → no servers count ⇒ MCP line omitted
 *   - populated allowlist    → only listed servers count
 *
 * @param cwd Current working directory used in the prompt text.
 * @param mcpHub Optional MCP hub. When omitted, the MCP line is never emitted.
 * @param allowedMcpServers Optional per-mode allowlist of MCP server names. When provided,
 *   the hub's servers are filtered to this set before determining MCP availability.
 */
export function getCapabilitiesSection(cwd: string, mcpHub?: McpHub, allowedMcpServers?: string[]): string {
	// Determine whether any MCP server is actually available to the current mode.
	// Filtering the hub's servers by the allowlist (when provided) keeps the capability
	// text consistent with the tools that are exposed for the mode.
	let hasMcpServers = false
	if (mcpHub) {
		let servers = mcpHub.getServers()
		if (allowedMcpServers) {
			const allowSet = new Set(allowedMcpServers)
			servers = servers.filter((server) => allowSet.has(server.name))
		}
		hasMcpServers = servers.length > 0
	}
	return `====

能力

- 你可以使用多种工具，在用户计算机上执行 CLI 命令、列出文件、查看源代码定义、正则搜索、读写文件以及提出后续问题。这些工具帮助你有效完成各种任务，例如编写代码、对现有文件进行编辑或改进、了解项目当前状态、执行系统操作等等。
- 当用户最初给你一个任务时，当前工作区目录（'${cwd}'）中所有文件路径的递归列表将包含在 environment_details 中。这提供了项目文件结构的概览，通过目录/文件名（开发者如何概念化和组织其代码）和文件扩展名（使用的语言）提供了关键洞察。这也可以指导决定进一步探索哪些文件。如果你需要进一步探索当前工作区目录之外的目录，可以使用 list_files 工具。如果你为 recursive 参数传递 'true'，它将递归列出文件。否则，它将仅列出顶层内容，这更适合通用目录，比如桌面，你不需要嵌套结构。
- 你可以随时使用 execute_command 工具在用户计算机上运行命令，只要你认为这有助于完成用户的任务。当你需要执行 CLI 命令时，必须清楚地解释该命令的作用。允许交互式和长时间运行的命令，因为命令在用户的 VSCode 终端中运行。用户可以让命令在后台运行，你会随时了解它们的状态。你执行的每个命令都在一个新的终端实例中运行。对于多行脚本，必须先用 write_to_file 创建临时脚本文件再执行；不要在命令中包含换行符，否则会被系统拒绝执行。${
		hasMcpServers
			? `
- 你可以访问 MCP 服务器，这些服务器可能提供额外的工具和资源。每个服务器可能提供不同的能力，你可以用来更有效地完成任务。
`
			: ""
	}`
}
