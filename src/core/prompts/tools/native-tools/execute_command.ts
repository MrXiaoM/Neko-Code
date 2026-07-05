import type OpenAI from "openai"

const EXECUTE_COMMAND_DESCRIPTION = `请求在系统上执行 CLI 命令。当你需要执行系统操作或运行特定命令来完成用户任务的任何步骤时使用此工具。你必须根据系统信息中的"命令执行 Shell""命令 Shell 类型""Shell 路径风格"和"Shell 命令链接符"定制命令，并清楚地解释该命令的作用。不要只根据操作系统猜测 Shell：Windows 上可能使用 Git Bash/MSYS/WSL，非 Windows 上也可能使用 PowerShell。对于命令链，请使用适合当前命令 Shell 的链接语法。除非用户明确要求跨 Shell 执行，否则不要用 \`cmd /c\`、\`powershell -Command\`、\`pwsh -Command\`、\`bash -lc\` 等包装普通命令。优先通过 cwd 参数表达命令工作目录；如果 cwd 已经是目标目录，或者将要复用/新建的终端工作目录已经是目标目录，不要在 command 中再次 \`cd\` 到同一目录（例如 cwd 已是 \`src\` 时不要执行 \`cd src && ...\`）。优先使用相对命令和路径，以避免位置敏感性，保持终端一致性。

不能使用 python -c、node -e 等工具以多行内联脚本的方式执行命令。所有多行脚本必须先用 write_to_file 创建临时文件，再通过 execute_command 执行该文件。如果命令中包含多行（即包含换行符 \\n），系统将直接拒绝执行并报错。请谨记：多行命令 = 拒绝执行。

参数：
- command：（必需）要执行的 CLI 命令。此命令应对当前操作系统有效。确保命令格式正确且不包含任何有害指令。
- cwd：（可选）执行命令的工作目录
- timeout：（可选）超时时间（秒）。超时后，命令继续在后台运行，你可以收到目前为止的输出。对于可能无限期运行的命令（如开发服务器或文件监视器）设置此项，以便你无需等待它们退出即可继续。

示例：执行 npm run dev
{ "command": "npm run dev", "cwd": null, "timeout": null }

示例：在指定目录中执行 ls
{ "command": "ls -la", "cwd": "/home/user/projects", "timeout": null }

示例：使用相对路径
{ "command": "touch ./testdata/example.file", "cwd": null, "timeout": null }

示例：带超时的构建运行
{ "command": "npm run build", "cwd": null, "timeout": 30 }`

const COMMAND_PARAMETER_DESCRIPTION = `要执行的 Shell 命令`

const CWD_PARAMETER_DESCRIPTION = `命令的可选工作目录，相对或绝对路径。使用此参数后，不要在 command 中重复 cd 到同一目录`

const TIMEOUT_PARAMETER_DESCRIPTION = `超时时间（秒）。超时后，命令继续在后台运行，返回目前为止收集的输出。用于长时间运行的进程，如开发服务器、文件监视器或任何可能不会自行退出的命令`

export default {
	type: "function",
	function: {
		name: "execute_command",
		description: EXECUTE_COMMAND_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: COMMAND_PARAMETER_DESCRIPTION,
				},
				cwd: {
					type: ["string", "null"],
					description: CWD_PARAMETER_DESCRIPTION,
				},
				timeout: {
					type: ["number", "null"],
					description: TIMEOUT_PARAMETER_DESCRIPTION,
				},
			},
			required: ["command", "cwd", "timeout"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
