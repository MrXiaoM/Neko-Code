import type OpenAI from "openai"

const WAIT_FOR_USER_CONFIRMATION_DESCRIPTION = `请求用户确认后再继续下一步。当后台命令或其他外部异步操作仍在进行，且继续前有必要等待用户确认时使用。必须说明等待的具体原因。

此工具只有“继续”操作；用户可以在文本框中补充说明。不要将它用于收集缺失信息，也不要用无关的命令或轮询操作来人为等待。

参数：
- reason：（必需）说明为什么需要用户确认继续等待或进行下一步`

const REASON_PARAMETER_DESCRIPTION = `需要用户确认继续的具体原因`

export default {
	type: "function",
	function: {
		name: "wait_for_user_confirmation",
		description: WAIT_FOR_USER_CONFIRMATION_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				reason: {
					type: "string",
					description: REASON_PARAMETER_DESCRIPTION,
				},
			},
			required: ["reason"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
