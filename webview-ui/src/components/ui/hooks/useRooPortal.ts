import { useState } from "react"
import { useMount } from "react-use"

export const useRooPortal = (id: string, useDocumentBody = false) => {
	const [container, setContainer] = useState<HTMLElement>()

	useMount(() => setContainer(useDocumentBody ? document.body : (document.getElementById(id) ?? undefined)))

	return container
}
