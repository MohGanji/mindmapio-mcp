import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { ApiError, type MindmapClient } from "../src/client.js";

async function connect(apiClient: MindmapClient): Promise<Client> {
  const server = createServer(apiClient);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("MCP server", () => {
  it("advertises one tool per documented operation, with input schemas", async () => {
    const client = await connect({} as MindmapClient);
    const { tools } = await client.listTools();
    // 17 operations in the OpenAPI document, 17 tools.
    expect(tools).toHaveLength(17);
    const map = tools.find((t) => t.name === "get_map")!;
    expect(map.inputSchema).toBeDefined();
    expect(map.inputSchema.properties).toHaveProperty("mapId");
  });

  it("advertises the annotations both Anthropic directories require", async () => {
    const client = await connect({} as MindmapClient);
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations?.title).toBeTruthy();
      expect(typeof tool.annotations?.readOnlyHint).toBe("boolean");
      expect(typeof tool.annotations?.destructiveHint).toBe("boolean");
    }
    const subtree = tools.find((t) => t.name === "get_subtree")!;
    expect(subtree.annotations!.title).toBe("Read a branch");
    expect(subtree.annotations!.readOnlyHint).toBe(true);
  });

  it("advertises the document's description, not a local paraphrase", async () => {
    const client = await connect({} as MindmapClient);
    const { tools } = await client.listTools();
    const retry = tools.find((t) => t.name === "retry_node")!;
    expect(retry.description).toContain("409");
  });

  it("reports the package's own version, not a second copy of it", async () => {
    const manifest = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8"),
    );
    const client = await connect({} as MindmapClient);
    expect(client.getServerVersion()!.version).toBe(manifest.version);
  });

  it("returns the client result as JSON text content", async () => {
    const apiClient = { getMap: vi.fn().mockResolvedValue({ id: "m1", title: "Hi" }) } as unknown as MindmapClient;
    const client = await connect(apiClient);
    const res: any = await client.callTool({ name: "get_map", arguments: { mapId: "m1" } });
    expect(apiClient.getMap).toHaveBeenCalledWith("m1");
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toEqual({ id: "m1", title: "Hi" });
  });

  it("surfaces an API error as a tool error without leaking the token", async () => {
    const apiClient = {
      getMap: vi.fn().mockRejectedValue(new ApiError(404, { error: "not found" })),
    } as unknown as MindmapClient;
    const client = await connect(apiClient);
    const res: any = await client.callTool({ name: "get_map", arguments: { mapId: "x" } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("404");
    expect(res.content[0].text).not.toContain("Bearer");
  });
});
