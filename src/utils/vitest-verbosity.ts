export function resolveVerbosity(argv = process.argv, env = process.env) {
	// Check if --no-silent flag is used (native vitest flag)
	const cliNoSilent = argv.includes("--no-silent") || argv.includes("--silent=false")
	const silent = !cliNoSilent // Silent by default

	// Check if verbose reporter is requested
	const wantsVerboseReporter = argv.some(
		(a) => a === "--reporter=verbose" || a === "-r=verbose" || a === "--reporter",
	)

	return {
		silent,
		reporters: ["dot", ...(wantsVerboseReporter ? ["verbose"] : [])],
		onConsoleLog: (_log: string, type: string) => {
			// Let Vitest report failures itself. Forwarding worker stderr during teardown
			// can leave the onUserConsoleLog RPC pending on Windows.
			if (!silent) return

			return false
		},
	}
}
