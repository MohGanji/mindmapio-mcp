import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildTools } from "../src/tools.js";
import type { MindmapClient } from "../src/client.js";

function fakeClient(): MindmapClient {
  return {
    listMaps: vi.fn().mockResolvedValue([{ id: "m1" }]),
    getMap: vi.fn().mockResolvedValue({ id: "m1" }),
    createMap: vi.fn().mockResolvedValue({ id: "m9" }),
    deleteMap: vi.fn().mockResolvedValue({ success: true }),
    publishMap: vi.fn().mockResolvedValue({ publicId: "pub123" }),
    unpublishMap: vi.fn().mockResolvedValue({ success: true }),
    publicMapUrls: vi.fn().mockReturnValue({
      publicId: "pub123",
      viewerUrl: "https://mindmap.io/app/pub123?node=root&zoom=keyword&cz=90",
      embedUrl: "https://mindmap.io/app/embed/pub123?node=root&zoom=keyword&cz=90",
    }),
    getNode: vi.fn().mockResolvedValue({ node: { id: "n1", children: [] }, children: [] }),
    getSubtree: vi.fn().mockResolvedValue({ node: { id: "n1", children: [] }, children: [] }),
    createNode: vi.fn().mockResolvedValue({ id: "n1", children: [] }),
    updateNode: vi.fn().mockResolvedValue({ success: true }),
    deleteNode: vi.fn().mockResolvedValue({ success: true }),
    submitNode: vi.fn().mockResolvedValue({ nodeId: "n1", status: "complete", messages: [] }),
    autoExpand: vi.fn().mockResolvedValue({ nodeId: "n1", childIds: ["c1"] }),
    retryNode: vi.fn().mockResolvedValue({ status: "complete", messages: [] }),
    interruptNode: vi.fn().mockResolvedValue({ id: "n1", children: [], status: "interrupted" }),
    uploadAttachment: vi
      .fn()
      .mockResolvedValue({ id: "att_1", url: "/api/files/att_1", mediaType: "image/png", size: 4 }),
    readAttachment: vi
      .fn()
      .mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), mediaType: "image/png" }),
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
        "publish_map",
        "retry_node",
        "submit_node",
        "read_attachment",
        "unpublish_map",
        "update_node",
        "upload_attachment",
      ].sort(),
    );
  });

  it("every tool has a description and an input schema", () => {
    for (const t of buildTools()) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema).toBeTypeOf("object");
    }
  });

  it("takes each description from the OpenAPI document, not a local copy", () => {
    const submit = tool("submit_node");
    // The document explains the generation gate and the metering; the
    // hand-written description this replaces said neither.
    expect(submit.description).toContain("The call BLOCKS");
    expect(submit.description).toContain("429");

    const expand = tool("auto_expand");
    expect(expand.description).toContain("does NOT recurse");
  });

  it("annotates every tool with the title and hints the directories require", () => {
    for (const t of buildTools()) {
      expect(t.annotations.title.length).toBeGreaterThan(0);
      expect(t.annotations.readOnlyHint).toBeTypeOf("boolean");
      expect(t.annotations.destructiveHint).toBeTypeOf("boolean");
    }
  });

  it("states hints per operation instead of deriving them from the HTTP method", () => {
    // The cases where the method is the wrong signal.
    expect(tool("publish_map").annotations.destructiveHint).toBe(false);
    expect(tool("unpublish_map").annotations.destructiveHint).toBe(false);
    expect(tool("submit_node").annotations.destructiveHint).toBe(false);
    expect(tool("delete_node").annotations.destructiveHint).toBe(true);
  });

  it("marks the read tools read-only", () => {
    for (const name of ["list_maps", "get_map", "get_node", "get_subtree"]) {
      expect(tool(name).annotations.readOnlyHint).toBe(true);
    }
    expect(tool("create_node").annotations.readOnlyHint).toBe(false);
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

  it("publish_map publishes then returns the framed links", async () => {
    const client = fakeClient();
    const result = await tool("publish_map").handler(client, { mapId: "m1", zoom: "keyword", cz: 90 });
    expect(client.publishMap).toHaveBeenCalledWith("m1");
    expect(client.publicMapUrls).toHaveBeenCalledWith("pub123", { zoom: "keyword", cz: 90 });
    expect(result).toEqual({
      publicId: "pub123",
      viewerUrl: "https://mindmap.io/app/pub123?node=root&zoom=keyword&cz=90",
      embedUrl: "https://mindmap.io/app/embed/pub123?node=root&zoom=keyword&cz=90",
    });
  });

  it("publish_map omits unset framing options", async () => {
    const client = fakeClient();
    await tool("publish_map").handler(client, { mapId: "m1" });
    expect(client.publicMapUrls).toHaveBeenCalledWith("pub123", {});
  });

  it("unpublish_map passes the map id", async () => {
    const client = fakeClient();
    await tool("unpublish_map").handler(client, { mapId: "m1" });
    expect(client.unpublishMap).toHaveBeenCalledWith("m1");
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

describe("attachment tool wiring", () => {
  function scratchFile(name: string, contents: string): string {
    const path = join(mkdtempSync(join(tmpdir(), "mmio-files-")), name);
    writeFileSync(path, contents);
    return path;
  }

  it("upload_attachment sends the file's bytes, media type and name", async () => {
    const client = fakeClient();
    const path = scratchFile("diagram.png", "PNG-BYTES");
    await tool("upload_attachment").handler(client, { mapId: "m1", path });
    const [mapId, file] = (client.uploadAttachment as any).mock.calls[0];
    expect(mapId).toBe("m1");
    expect(file.mediaType).toBe("image/png");
    expect(file.filename).toBe("diagram.png");
    expect(Buffer.from(file.bytes).toString()).toBe("PNG-BYTES");
  });

  it("upload_attachment infers the media type from the extension, pdf included", async () => {
    const client = fakeClient();
    await tool("upload_attachment").handler(client, { mapId: "m1", path: scratchFile("paper.PDF", "%PDF") });
    expect((client.uploadAttachment as any).mock.calls[0][1].mediaType).toBe("application/pdf");
  });

  it("upload_attachment refuses a type the API does not accept, and says which it does", async () => {
    const client = fakeClient();
    const path = scratchFile("notes.txt", "hello");
    await expect(tool("upload_attachment").handler(client, { mapId: "m1", path })).rejects.toThrow(
      /image\/png/,
    );
    expect(client.uploadAttachment).not.toHaveBeenCalled();
  });

  it("read_attachment saves the file locally and reports where it landed", async () => {
    const client = fakeClient();
    const destination = join(mkdtempSync(join(tmpdir(), "mmio-files-")), "out.png");
    const result: any = await tool("read_attachment").handler(client, {
      attachmentId: "att_1",
      path: destination,
    });
    expect(client.readAttachment).toHaveBeenCalledWith("att_1");
    expect(result.path).toBe(destination);
    expect(result.mediaType).toBe("image/png");
    expect(result.size).toBe(3);
    expect([...readFileSync(destination)]).toEqual([1, 2, 3]);
  });

  it("read_attachment defaults to a temp file rather than writing where it was not asked", async () => {
    const client = fakeClient();
    const result: any = await tool("read_attachment").handler(client, { attachmentId: "att_1" });
    expect(result.path.startsWith(tmpdir())).toBe(true);
    expect([...readFileSync(result.path)]).toEqual([1, 2, 3]);
  });
});
