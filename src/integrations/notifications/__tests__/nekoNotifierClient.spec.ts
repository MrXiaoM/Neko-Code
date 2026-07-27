import * as fs from "fs/promises"
import * as http from "http"
import * as os from "os"
import * as path from "path"

import { afterEach, describe, expect, it } from "vitest"
import nock from "nock"

import { NekoNotifierClient, parseNekoNotifierDiscovery } from "../nekoNotifierClient"

const validDiscovery = {
	protocolVersion: 1,
	host: "127.0.0.1",
	port: 43123,
	pid: 1234,
	instanceId: "instance-1",
	token: "x".repeat(64),
	startedAt: "2026-07-25T16:00:00.000Z",
} as const

const cleanupCallbacks: Array<() => Promise<void>> = []

afterEach(async () => {
	while (cleanupCallbacks.length > 0) {
		await cleanupCallbacks.pop()?.()
	}
	nock.disableNetConnect()
})

async function createHealthFixture(healthInstanceId: string) {
	nock.enableNetConnect("127.0.0.1")
	const token = "s".repeat(64)
	let removeClientRequests = 0
	const server = http.createServer((request, response) => {
		if (request.headers.authorization !== `Bearer ${token}`) {
			response.writeHead(401).end()
			return
		}
		if (request.url === "/v1/health") {
			response.writeHead(200, { "Content-Type": "application/json" })
			response.end(
				JSON.stringify({
					status: "ok",
					protocolVersion: 1,
					instanceId: healthInstanceId,
					pendingCount: 0,
					leaseTtlSeconds: 20,
					heartbeatIntervalSeconds: 5,
				}),
			)
			return
		}
		if (request.method === "POST" && request.url === "/v1/clients/remove") {
			removeClientRequests += 1
			response.writeHead(200, { "Content-Type": "application/json" })
			response.end(JSON.stringify({ removedCount: 0, pendingCount: 0 }))
			return
		}
		response.writeHead(404).end()
	})
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(0, "127.0.0.1", resolve)
	})
	const address = server.address()
	if (!address || typeof address === "string") {
		throw new Error("fixture server did not expose a port")
	}
	const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "neko-notifier-client-"))
	await fs.writeFile(
		path.join(dataDirectory, "neko-notifier.json"),
		JSON.stringify({ ...validDiscovery, port: address.port, token }),
		"utf8",
	)
	cleanupCallbacks.push(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()))
		await fs.rm(dataDirectory, { recursive: true, force: true })
	})
	return { dataDirectory, getRemoveClientRequests: () => removeClientRequests }
}

describe("parseNekoNotifierDiscovery", () => {
	it("accepts a valid versioned loopback discovery object", () => {
		expect(parseNekoNotifierDiscovery(validDiscovery)).toEqual(validDiscovery)
	})

	it.each([
		[{ ...validDiscovery, protocolVersion: 2 }, "protocol"],
		[{ ...validDiscovery, host: "localhost" }, "loopback"],
		[{ ...validDiscovery, port: 0 }, "port"],
		[{ ...validDiscovery, port: 65_536 }, "port"],
		[{ ...validDiscovery, token: "short" }, "identity"],
		[{ ...validDiscovery, startedAt: "not-a-date" }, "start time"],
	])("rejects malformed discovery data %#", (value, message) => {
		expect(() => parseNekoNotifierDiscovery(value)).toThrow(message)
	})
})

describe("NekoNotifierClient health gate", () => {
	it("enables only after authenticated health identity validation and removes client leases on dispose", async () => {
		const fixture = await createHealthFixture(validDiscovery.instanceId)
		const client = new NekoNotifierClient()
		cleanupCallbacks.push(() => client.dispose())

		await expect(client.configure(fixture.dataDirectory)).resolves.toBe(true)
		await client.dispose()
		expect(fixture.getRemoveClientRequests()).toBe(1)
	})

	it("stays disabled when the health instance identity differs from discovery", async () => {
		const fixture = await createHealthFixture("different-instance")
		const client = new NekoNotifierClient()
		cleanupCallbacks.push(() => client.dispose())

		await expect(client.configure(fixture.dataDirectory)).resolves.toBe(false)
	})
})
