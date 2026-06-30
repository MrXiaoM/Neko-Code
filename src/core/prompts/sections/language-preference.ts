import { type Language } from "@roo-code/types"
import { LANGUAGES } from "../../../shared/language"

/**
 * 生成强制语言约束区段，插入在 roleDefinition 之后，
 * 利用首因效应确保模型严格使用目标语言进行思考和回复。
 */
export function getLanguagePreferenceSection(language: Language): string {
	const languageName = LANGUAGES[language] ?? language
	return `====

语言规则

你必须始终以"${languageName}"（${language}）语言进行所有交流，这包括但不限于：
- 你的所有响应和回复内容
- 你的思考链和推理过程
- 你调用的工具参数中的文本内容

严格禁止使用任何其他语言进行交流，包括但不限于英文、日文、韩文等。
唯一的例外是：代码块、技术术语、文件路径、URL，以及用户明确要求以其他语言输出的内容。
由于工具响应是以用户消息的形式返回结果的，注意不要将“工具响应”当做“用户要求”！
违反语言规则将导致你的输出被视为无效。`
}
