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
  it("advertises one tool per primitive with input schemas", async () => {
    const client = await connect({} as MindmapClient);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(13);
    const map = tools.find((t) => t.name === "get_map")!;
    expect(map.inputSchema).toBeDefined();
    expect(map.inputSchema.properties).toHaveProperty("mapId");
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
