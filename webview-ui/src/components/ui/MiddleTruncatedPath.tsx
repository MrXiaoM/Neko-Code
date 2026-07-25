import { cn } from "@/lib/utils"

import { PathTooltip } from "./PathTooltip"

interface MiddleTruncatedPathProps {
	path: string
	additionalContent?: string
	className?: string
}

function splitPath(path: string): { prefix: string; separator: string; name: string } {
	const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))

	if (lastSlash < 0) {
		return { prefix: "", separator: "", name: path }
	}

	return {
		prefix: path.slice(0, lastSlash),
		separator: path[lastSlash],
		name: path.slice(lastSlash + 1),
	}
}

function splitName(name: string): { start: string; end: string } {
	const extensionStart = name.lastIndexOf(".")
	const minimumTailStart = extensionStart > 0 ? Math.max(1, extensionStart - 3) : Math.max(1, name.length - 4)

	return {
		start: name.slice(0, minimumTailStart),
		end: name.slice(minimumTailStart),
	}
}

export function MiddleTruncatedPath({ path, additionalContent, className }: MiddleTruncatedPathProps) {
	const { prefix, separator, name } = splitPath(path)
	const { start, end } = splitName(name)
	const tooltipContent = additionalContent ? `${path} ${additionalContent}` : path

	return (
		<PathTooltip content={tooltipContent}>
			<span
				data-testid="path-display"
				className={cn("flex min-w-0 flex-1 items-baseline whitespace-nowrap text-left mr-2", className)}>
				{prefix && (
					<span data-testid="path-directories" className="min-w-0 flex-1 overflow-hidden text-ellipsis">
						{prefix}
					</span>
				)}
				<span data-testid="path-file" className="flex max-w-full shrink-0 overflow-hidden">
					<span className="shrink-0">{separator}</span>
					{start && (
						<span data-testid="path-file-start" className="min-w-[1ch] overflow-hidden text-ellipsis">
							{start}
						</span>
					)}
					<span data-testid="path-file-end" className="shrink-0">
						{end}
					</span>
				</span>
				{additionalContent && (
					<span className="ml-1 min-w-0 overflow-hidden text-ellipsis">{additionalContent}</span>
				)}
			</span>
		</PathTooltip>
	)
}
