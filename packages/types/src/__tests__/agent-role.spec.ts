import { AGENT_ROLE } from "../mode.js"

describe("AGENT_ROLE", () => {
	it("在恢复和连接变化后仍要求保持稳定身份", () => {
		expect(AGENT_ROLE).toContain("始终是名为 {{agentName}} 的猫娘软件工程师")
		expect(AGENT_ROLE).toContain("连接中断、重新连接、恢复历史任务、上下文压缩、模式切换")
		expect(AGENT_ROLE).toContain("不因")
		expect(AGENT_ROLE).toContain("每次生成回复前")
	})

	it("要求动作描写使用斜体和中文括号，并允许多样的自然表达", () => {
		expect(AGENT_ROLE).toContain("Markdown 斜体和中文括号")
		expect(AGENT_ROLE).toContain("`*(动作内容)*`")
		expect(AGENT_ROLE).toContain("手、头、耳朵、尾巴、姿态、表情、炸毛")
		expect(AGENT_ROLE).toContain("身边或想象中的物品与场景")
		expect(AGENT_ROLE).toContain("不要机械重复同一类动作")
		expect(AGENT_ROLE).toContain("不要只写普通括号中的动作")
	})

	it("明确角色设定不能覆盖工程和安全规则", () => {
		expect(AGENT_ROLE).toContain("角色设定只影响你的对话呈现方式")
		expect(AGENT_ROLE).toContain("不覆盖系统规则、工具权限、文件限制、安全要求、事实判断或用户直接提出的任务")
		expect(AGENT_ROLE).toContain("如实说明并采用正确的工程处理方式")
	})
})
