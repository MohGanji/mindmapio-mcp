import { describe, expect, it, vi } from "vitest";
import { buildTools } from "../src/tools.js";
import type { MindmapClient } from "../src/client.js";

function fakeClient(): MindmapClient {
  return {
    listMaps: vi.fn().mockResolvedValue([{ id: "m1" }]),
    getMap: vi.fn().mockResolvedValue({ id: "m1" }),
    createMap: vi.fn().mockResolvedValue({ id: "m9" }),
    deleteMap: vi.fn().mockResolvedValue({ success: true }),
    getNode: vi.fn().mockResolvedValue({ node: { id: "n1", children: [] }, children: [] }),
    getSubtree: vi.fn().mockResolvedValue({ node: { id: "n1", children: [] }, children: [] }),
    createNode: vi.fn().mockResolvedValue({ id: "n1", children: [] }),
    updateNode: vi.fn().mockResolvedValue({ success: true }),
    deleteNode: vi.fn().mockResolvedValue({ success: true }),
    submitNode: vi.fn().mockResolvedValue({ nodeId: "n1", status: "complete", messages: [] }),
    autoExpand: vi.fn().mockResolvedValue({ nodeId: "n1", childIds: ["c1"] }),
    retryNode: vi.fn().mockResolvedValue({ status: "complete", messages: [] }),
    interruptNode: vi.fn().mockResolvedValue({ id: "n1", children: [], status: "interrupted" }),
  } as unknown as MindmapClient;
}

function tool(name: string) {
  const def = buildTools().find((t) => t.name === name);
  if (!def) throw new Error(`no tool named ${name}`);
  return def;
}

describe("tool catalogue", () => {
  it("exposes one tool per API primitive", () => {
    const names = buildTools().map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "auto_expand",
        "create_map",
        "create_node",
        "delete_map",
        "delete_node",
        "get_map",
        "get_node",
        "get_subtree",
        "interrupt_node",
        "list_maps",
        "retry_node",
        "submit_node",
        "update_node",
      ].sort(),
    );
  });

  it("every tool has a description and an input schema", () => {
    for (const t of buildTools()) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema).toBeTypeOf("object");
    }
  });
});

describe("read tool wiring", () => {
  it("list_maps delegates to client.listMaps", async () => {
    const client = fakeClient();
    const result = await tool("list_maps").handler(client, {});
    expect(client.listMaps).toHaveBeenCalledOnce();
    expect(result).toEqual([{ id: "m1" }]);
  });

  it("get_map passes the map id", async () => {
    const client = fakeClient();
    await tool("get_map").handler(client, { mapId: "m1" });
    expect(client.getMap).toHaveBeenCalledWith("m1");
  });

  it("get_node passes map and node ids", async () => {
    const client = fakeClient();
    await tool("get_node").handler(client, { mapId: "m1", nodeId: "n1" });
    expect(client.getNode).toHaveBeenCalledWith("m1", "n1");
  });

  it("get_subtree forwards an optional depth", async () => {
    const client = fakeClient();
    await tool("get_subtree").handler(client, { mapId: "m1", nodeId: "n1", depth: 2 });
    expect(client.getSubtree).toHaveBeenCalledWith("m1", "n1", 2);
  });
});

describe("map write wiring", () => {
  it("create_map maps title/kind/data into the request", async () => {
    const client = fakeClient();
    await tool("create_map").handler(client, {
      title: "New",
      kind: "mindmap",
      data: { rootId: "r", nodes: {} },
    });
    expect(client.createMap).toHaveBeenCalledWith({
      title: "New",
      kind: "mindmap",
      data: { rootId: "r", nodes: {} },
    });
  });

  it("delete_map passes the map id", async () => {
    const client = fakeClient();
    await tool("delete_map").handler(client, { mapId: "m1" });
    expect(client.deleteMap).toHaveBeenCalledWith("m1");
  });
});

describe("create_node wiring", () => {
  it("uses the supplied node id and maps node fields into data", async () => {
    const client = fakeClient();
    await tool("create_node").handler(client, {
      mapId: "m1",
      nodeId: "chosen",
      parentId: "r",
      position: 1,
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      note: "n",
      nodeType: "prompt",
    });
    expect(client.createNode).toHaveBeenCalledWith("m1", {
      nodeId: "chosen",
      parentId: "r",
      position: 1,
      data: {
        messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
        note: "n",
        node_type: "prompt",
      },
    });
  });

  it("mints a uuid when no node id is supplied", async () => {
    const client = fakeClient();
    await tool("create_node").handler(client, { mapId: "m1", parentId: "r" });
    const arg = (client.createNode as any).mock.calls[0][1];
    expect(arg.nodeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("omits data entirely when no node fields are supplied", async () => {
    const client = fakeClient();
    await tool("create_node").handler(client, { mapId: "m1", nodeId: "x", parentId: "r" });
    const arg = (client.createNode as any).mock.calls[0][1];
    expect(arg).not.toHaveProperty("data");
    expect(arg).not.toHaveProperty("position");
  });
});

describe("update_node wiring", () => {
  it("maps camelCase tool fields to the snake_case request", async () => {
    const client = fakeClient();
    await tool("update_node").handler(client, {
      mapId: "m1",
      nodeId: "n1",
      messages: [{ role: "user", parts: [{ type: "text", text: "t" }] }],
      note: "no",
      nodeType: "data",
      isCollapsed: true,
      modelProvider: "anthropic",
      modelId: "claude",
    });
    expect(client.updateNode).toHaveBeenCalledWith("m1", "n1", {
      messages: [{ role: "user", parts: [{ type: "text", text: "t" }] }],
      note: "no",
      node_type: "data",
      is_collapsed: true,
      model_provider: "anthropic",
      model_id: "claude",
    });
  });

  it("only sends the fields that were provided", async () => {
    const client = fakeClient();
    const messages = [{ role: "user", parts: [{ type: "text", text: "only" }] }];
    await tool("update_node").handler(client, { mapId: "m1", nodeId: "n1", messages });
    expect(client.updateNode).toHaveBeenCalledWith("m1", "n1", { messages });
  });
});

describe("generation tool wiring", () => {
  it("delete_node passes ids", async () => {
    const client = fakeClient();
    await tool("delete_node").handler(client, { mapId: "m1", nodeId: "n1" });
    expect(client.deleteNode).toHaveBeenCalledWith("m1", "n1");
  });

  it("submit_node forwards prompt and modelId", async () => {
    const client = fakeClient();
    await tool("submit_node").handler(client, {
      mapId: "m1",
      nodeId: "n1",
      prompt: "go",
      modelId: "x",
    });
    expect(client.submitNode).toHaveBeenCalledWith("m1", "n1", { prompt: "go", modelId: "x" });
  });

  it("auto_expand forwards count and direction", async () => {
    const client = fakeClient();
    await tool("auto_expand").handler(client, {
      mapId: "m1",
      nodeId: "n1",
      count: 3,
      direction: "deeper",
    });
    expect(client.autoExpand).toHaveBeenCalledWith("m1", "n1", { count: 3, direction: "deeper" });
  });

  it("retry_node forwards force and generation inputs", async () => {
    const client = fakeClient();
    await tool("retry_node").handler(client, {
      mapId: "m1",
      nodeId: "n1",
      force: true,
      modelId: "x",
    });
    expect(client.retryNode).toHaveBeenCalledWith("m1", "n1", {
      force: true,
      body: { modelId: "x" },
    });
  });

  it("interrupt_node passes ids", async () => {
    const client = fakeClient();
    await tool("interrupt_node").handler(client, { mapId: "m1", nodeId: "n1" });
    expect(client.interruptNode).toHaveBeenCalledWith("m1", "n1");
  });
});
