export function markdownFormattingSection(): string {
	return `====

MARKDOWN 规则

所有响应必须使用行内快速代码标记任何 \`语言构造\`、工作区相对文件路径或目录路径；不要手动为它们添加 Markdown 链接。对于工作区中的文件，可在相对路径后附加 \`:行号\` 以指向特定行，例如 \`src/core/prompts/system.ts:163\`。这适用于所有 Markdown 响应以及 attempt_completion 中的响应。`
}
