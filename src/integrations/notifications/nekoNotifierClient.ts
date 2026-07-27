import { randomBytes } from "crypto"
import * as fs from "fs/promises"
import * as http from "http"
import * as path from "path"

import { getNekoNotifierApprovalCallback } from "./approvalNotification"

const PROTOCOL_VERSION = 1
const DISCOVERY_FILE_NAME = "neko-notifier.json"
const MAX_DISCOVERY_BYTES = 64 * 1024
const REQUEST_TIMEOUT_MS = 2_000
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000

export interface NekoNotifierDiscovery {
	protocolVersion: 1
	host: "127.0.0.1"
	port: number
	pid: number
	instanceId: string
	token: string
	startedAt: string
}

interface HealthResponse {
	status: "ok"
	protocolVersion: 1
	instanceId: string
	pendingCount: number
	leaseTtlSeconds: number
	heartbeatIntervalSeconds: number
}

export interface ApprovalLeaseInput {
	notificationId: string
	title: string
	body: string
}

interface RequestOptions {
	method?: string
	path: string
	body?: unknown
	headers?: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, minimum: number, maximum: number): value is string {
	return typeof value === "string" && value.length >= minimum && value.length <= maximum
}

export function parseNekoNotifierDiscovery(value: unknown): NekoNotifierDiscovery {
	if (!isRecord(value)) {
		throw new Error("discovery file must contain an object")
	}
	if (value.protocolVersion !== PROTOCOL_VERSION || value.host !== "127.0.0.1") {
		throw new Error("unsupported protocol or non-loopback host")
	}
	if (!Number.isInteger(value.port) || (value.port as number) < 1 || (value.port as number) > 65_535) {
		throw new Error("invalid service port")
	}
	if (!Number.isSafeInteger(value.pid) || (value.pid as number) < 1) {
		throw new Error("invalid service PID")
	}
	if (!isBoundedString(value.instanceId, 1, 160) || !isBoundedString(value.token, 32, 256)) {
		throw new Error("invalid service identity")
	}
	if (!isBoundedString(value.startedAt, 1, 128) || !Number.isFinite(Date.parse(value.startedAt))) {
		throw new Error("invalid service start time")
	}
	return value as unknown as NekoNotifierDiscovery
}

export async function readNekoNotifierDiscovery(dataDirectory: string): Promise<NekoNotifierDiscovery> {
	const directory = dataDirectory.trim()
	if (!directory) {
		throw new Error("data directory is empty")
	}
	const filePath = path.join(directory, DISCOVERY_FILE_NAME)
	const stat = await fs.stat(filePath)
	if (!stat.isFile() || stat.size < 2 || stat.size > MAX_DISCOVERY_BYTES) {
		throw new Error("discovery file has an invalid size")
	}
	const content = await fs.readFile(filePath, "utf8")
	return parseNekoNotifierDiscovery(JSON.parse(content) as unknown)
}

export class NekoNotifierClient {
	private discovery: NekoNotifierDiscovery | undefined
	private heartbeatTimer: NodeJS.Timeout | undefined
	private readonly activeNotificationIds = new Set<string>()
	private readonly clientId = `zoo-code-${randomBytes(16).toString("hex")}`

	async configure(dataDirectory: string | undefined): Promise<boolean> {
		await this.removeClientLeases()
		this.stopHeartbeat()
		this.discovery = undefined
		this.activeNotificationIds.clear()
		if (process.platform !== "win32" || !dataDirectory?.trim()) {
			return false
		}

		try {
			const discovery = await readNekoNotifierDiscovery(dataDirectory)
			this.discovery = discovery
			const health = await this.requestJson<HealthResponse>({ path: "/v1/health" })
			if (
				health.status !== "ok" ||
				health.protocolVersion !== PROTOCOL_VERSION ||
				health.instanceId !== discovery.instanceId ||
				!Number.isFinite(health.heartbeatIntervalSeconds) ||
				health.heartbeatIntervalSeconds <= 0
			) {
				throw new Error("health response does not match discovery identity")
			}
			this.startHeartbeat(health.heartbeatIntervalSeconds * 1_000)
			return true
		} catch (error) {
			this.disable(error)
			return false
		}
	}

	async registerApproval(input: ApprovalLeaseInput): Promise<boolean> {
		const callback = getNekoNotifierApprovalCallback()
		if (!this.discovery || !callback) {
			return false
		}
		try {
			await this.requestJson({
				method: "PUT",
				path: `/v1/approvals/${encodeURIComponent(input.notificationId)}`,
				body: {
					protocolVersion: PROTOCOL_VERSION,
					notificationId: input.notificationId,
					clientId: this.clientId,
					title: input.title.slice(0, 512),
					body: input.body.slice(0, 512),
					callbackUrl: callback.callbackUrl,
					callbackToken: callback.callbackToken,
				},
			})
			this.activeNotificationIds.add(input.notificationId)
			return true
		} catch (error) {
			this.disable(error)
			return false
		}
	}

	async removeApproval(notificationId: string): Promise<void> {
		this.activeNotificationIds.delete(notificationId)
		if (!this.discovery) {
			return
		}
		try {
			await this.requestJson({
				method: "DELETE",
				path: `/v1/approvals/${encodeURIComponent(notificationId)}`,
				headers: {
					"X-Neko-Client-Id": this.clientId,
					"X-Neko-Protocol-Version": String(PROTOCOL_VERSION),
				},
			})
		} catch (error) {
			this.disable(error)
		}
	}

	async dispose(): Promise<void> {
		await this.removeClientLeases()
		this.stopHeartbeat()
		this.discovery = undefined
		this.activeNotificationIds.clear()
	}

	private async heartbeat(): Promise<void> {
		if (!this.discovery || this.activeNotificationIds.size === 0) {
			return
		}
		try {
			await this.requestJson({
				method: "POST",
				path: "/v1/heartbeats",
				body: {
					protocolVersion: PROTOCOL_VERSION,
					clientId: this.clientId,
					notificationIds: [...this.activeNotificationIds],
				},
			})
		} catch (error) {
			this.disable(error)
		}
	}

	private async removeClientLeases(): Promise<void> {
		if (!this.discovery) {
			return
		}
		try {
			await this.requestJson({
				method: "POST",
				path: "/v1/clients/remove",
				body: { protocolVersion: PROTOCOL_VERSION, clientId: this.clientId },
			})
		} catch {
			// TTL remains the final cleanup mechanism when the service is unavailable.
		}
	}

	private startHeartbeat(intervalMs: number): void {
		this.stopHeartbeat()
		const safeInterval = Math.max(1_000, Math.min(intervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS, 60_000))
		this.heartbeatTimer = setInterval(() => void this.heartbeat(), safeInterval)
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer)
			this.heartbeatTimer = undefined
		}
	}

	private disable(error: unknown): void {
		console.warn("[NekoNotifier] Client disabled:", error instanceof Error ? error.message : String(error))
		this.stopHeartbeat()
		this.discovery = undefined
		this.activeNotificationIds.clear()
	}

	private requestJson<T = unknown>(options: RequestOptions): Promise<T> {
		const discovery = this.discovery
		if (!discovery) {
			return Promise.reject(new Error("client is disabled"))
		}
		const body = options.body === undefined ? undefined : JSON.stringify(options.body)
		return new Promise<T>((resolve, reject) => {
			const request = http.request(
				{
					host: discovery.host,
					port: discovery.port,
					path: options.path,
					method: options.method ?? "GET",
					headers: {
						Authorization: `Bearer ${discovery.token}`,
						Accept: "application/json",
						...(body
							? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
							: {}),
						...options.headers,
					},
				},
				(response) => {
					const chunks: Buffer[] = []
					let size = 0
					response.on("data", (chunk: Buffer) => {
						size += chunk.length
						if (size > MAX_DISCOVERY_BYTES) {
							request.destroy(new Error("service response is too large"))
							return
						}
						chunks.push(chunk)
					})
					response.on("end", () => {
						if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
							reject(new Error(`service request failed with status ${response.statusCode ?? 0}`))
							return
						}
						try {
							resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T)
						} catch (error) {
							reject(error)
						}
					})
				},
			)
			request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("service request timed out")))
			request.once("error", reject)
			if (body) {
				request.write(body)
			}
			request.end()
		})
	}
}

export const nekoNotifierClient = new NekoNotifierClient()
