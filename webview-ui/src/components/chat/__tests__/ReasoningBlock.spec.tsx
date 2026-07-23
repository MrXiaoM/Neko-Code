import React from "react"

import { render, screen } from "@/utils/test-utils"

import { ReasoningBlock } from "../ReasoningBlock"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		reasoningBlockCollapsed: false,
	}),
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const map: Record<string, string> = {
				"chat:reasoning.thinking": "Thinking",
				"chat:reasoning.seconds": "{{count}} seconds",
			}
			return map[key] ?? key
		},
	}),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

describe("ReasoningBlock", () => {
	it("renders a thick description-colored left border for reasoning content", () => {
		const { container } = render(
			<ReasoningBlock content="Reasoning content" ts={1} isStreaming={false} isLast={false} />,
		)

		expect(screen.getByText("Reasoning content")).toBeInTheDocument()
		expect(
			container.querySelector('[class~="border-l-2"][class~="border-vscode-descriptionForeground/20"]'),
		).toBeInTheDocument()
	})
})
