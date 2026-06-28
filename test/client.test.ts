import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, MindmapClient } from "../src/client.js";

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let captured: CapturedCall[];
let fetchMock: ReturnType<typeof vi.fn>;

function mockNext(response: Response): void {
  fetchMock.mockImplementationOnce(async (input: any, init: any) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    captured.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    return response;
  });
}

function makeClient(): MindmapClient {
  return new MindmapClient({ token: "secret-pat", baseUrl: "https://api.example.test" });
}

beforeEach(() => {
  captured = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("auth + config", () => {
  it("sends the bearer token on every request", async () => {
    mockNext(jsonResponse([]));
    await makeClient().listMaps();
    expect(captured[0].headers["authorization"]).toBe("Bearer secret-pat");
  });

  it("reads token and base url from the environment when not passed", async () => {
    vi.stubEnv("MINDMAP_API_TOKEN", "env-token");
    vi.stubEnv("MINDMAP_API_BASE_URL", "https://env.example.test");
    mockNext(jsonResponse([]));
    await new MindmapClient().listMaps();
    expect(captured[0].url).toBe("https://env.example.test/api/mindmaps");
    expect(captured[0].headers["authorization"]).toBe("Bearer env-token");
  });

  it("defaults the base url to https://mindmap.io", async () => {
    vi.stubEnv("MINDMAP_API_TOKEN", "env-token");
    vi.stubEnv("MINDMAP_API_BASE_URL", "");
    mockNext(jsonResponse([]));
    await new MindmapClient().listMaps();
    expect(captured[0].url).toBe("https://mindmap.io/api/mindmaps");
  });

  it("throws when no token is available", () => {
    vi.stubEnv("MINDMAP_API_TOKEN", "");
    expect(() => new MindmapClient()).toThrow();
  });
});

describe("read endpoints", () => {
  it("listMaps GETs /api/mindmaps and returns the array", async () => {
    const maps = [{ id: "m1", title: "One" }];
    mockNext(jsonResponse(maps));
    const result = await makeClient().listMaps();
    expect(captured[0].method).toBe("GET");
    expect(captured[0].url).toBe("https://api.example.test/api/mindmaps");
    expect(result).toEqual(maps);
  });

  it("getMap GETs /api/mindmaps/{id}", async () => {
    const map = { id: "m1", data: { rootId: "r", nodes: {} } };
    mockNext(jsonResponse(map));
    const result = await makeClient().getMap("m1");
    expect(captured[0].method).toBe("GET");
    expect(captured[0].url).toBe("https://api.example.test/api/mindmaps/m1");
    expect(result).toEqual(map);
  });

  it("getNode GETs /api/mindmaps/{mapId}/nodes/{nodeId}", async () => {
    const subtree = { node: { id: "n1", children: [] }, children: [] };
    mockNext(jsonResponse(subtree));
    const result = await makeClient().getNode("m1", "n1");
    expect(captured[0].method).toBe("GET");
    expect(captured[0].url).toBe("https://api.example.test/api/mindmaps/m1/nodes/n1");
    expect(result).toEqual(subtree);
  });

  it("getSubtree GETs the subtree path without depth when omitted", async () => {
    mockNext(jsonResponse({ node: { id: "n1", children: [] }, children: [] }));
    await makeClient().getSubtree("m1", "n1");
    expect(captured[0].url).toBe("https://api.example.test/api/mindmaps/m1/nodes/n1/subtree");
  });

  it("getSubtree appends the depth query param when provided", async () => {
    mockNext(jsonResponse({ node: { id: "n1", children: [] }, children: [] }));
    await makeClient().getSubtree("m1", "n1", 2);
    expect(captured[0].url).toBe(
      "https://api.example.test/api/mindmaps/m1/nodes/n1/subtree?depth=2",
    );
  });

  it("getSubtree includes depth=0", async () => {
    mockNext(jsonResponse({ node: { id: "n1", children: [] }, children: [] }));
    await makeClient().getSubtree("m1", "n1", 0);
    expect(captured[0].url).toBe(
      "https://api.example.test/api/mindmaps/m1/nodes/n1/subtree?depth=0",
    );
  });
});

describe("map writes", () => {
  it("createMap POSTs /api/mindmaps with the body", async () => {
    mockNext(jsonResponse({ id: "m9" }, 201));
    const body = { title: "New", data: { rootId: "r", nodes: {} } };
    const result = await makeClient().createMap(body);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe("https://api.example.test/api/mindmaps");
    expect(captured[0].headers["content-type"]).toBe("application/json");
    expect(captured[0].body).toEqual(body);
    expect(result).toEqual({ id: "m9" });
  });

  it("deleteMap DELETEs /api/mindmaps/{id}", async () => {
    mockNext(jsonResponse({ success: true }));
    const result = await makeClient().deleteMap("m1");
    expect(captured[0].method).toBe("DELETE");
    expect(captured[0].url).toBe("https://api.example.test/api/mindmaps/m1");
    expect(result).toEqual({ success: true });
  });
});

describe("node writes", () => {
  it("createNode POSTs /api/mindmaps/{mapId}/nodes with the body", async () => {
    const node = { id: "n1", children: [] };
    mockNext(jsonResponse(node, 201));
    const body = {
      nodeId: "n1",
      parentId: "r",
      data: { messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }] },
    };
    const result = await makeClient().createNode("m1", body);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe("https://api.example.test/api/mindmaps/m1/nodes");
    expect(captured[0].body).toEqual(body);
    expect(result).toEqual(node);
  });

  it("updateNode PATCHes the node path with the body", async () => {
    mockNext(jsonResponse({ success: true }));
    const body = {
      messages: [{ role: "user", parts: [{ type: "text", text: "updated" }] }],
      is_collapsed: true,
    };
    const result = await makeClient().updateNode("m1", "n1", body);
    expect(captured[0].method).toBe("PATCH");
    expect(captured[0].url).toBe("https://api.example.test/api/mindmaps/m1/nodes/n1");
    expect(captured[0].body).toEqual(body);
    expect(result).toEqual({ success: true });
  });

  it("deleteNode DELETEs the node path", async () => {
    mockNext(jsonResponse({ success: true }));
    const result = await makeClient().deleteNode("m1", "n1");
    expect(captured[0].method).toBe("DELETE");
    expect(captured[0].url).toBe("https://api.example.test/api/mindmaps/m1/nodes/n1");
    expect(result).toEqual({ success: true });
  });
});

describe("generation endpoints", () => {
  it("submitNode POSTs the submit path and returns the completed node", async () => {
    const resp = { nodeId: "n1", status: "complete", messages: [{ role: "assistant" }] };
    mockNext(jsonResponse(resp));
    const result = await makeClient().submitNode("m1", "n1", { prompt: "go" });
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe("https://api.example.test/api/mindmaps/m1/nodes/n1/submit");
    expect(captured[0].body).toEqual({ prompt: "go" });
    expect(result).toEqual(resp);
  });

  it("submitNode sends an empty object body when no inputs are given", async () => {
    mockNext(jsonResponse({ nodeId: "n1", status: "complete", messages: [] }));
    await makeClient().submitNode("m1", "n1");
    expect(captured[0].body).toEqual({});
  });

  it("autoExpand POSTs the auto-expand path and returns child ids", async () => {
    const resp = { nodeId: "n1", childIds: ["c1", "c2"] };
    mockNext(jsonResponse(resp));
    const result = await makeClient().autoExpand("m1", "n1", { count: 2 });
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe(
      "https://api.example.test/api/mindmaps/m1/nodes/n1/auto-expand",
    );
    expect(captured[0].body).toEqual({ count: 2 });
    expect(result).toEqual(resp);
  });

  it("retryNode POSTs the retry path without force by default", async () => {
    mockNext(jsonResponse({ status: "complete", messages: [] }));
    await makeClient().retryNode("m1", "n1");
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe("https://api.example.test/api/mindmaps/m1/nodes/n1/retry");
  });

  it("retryNode appends force=true when requested", async () => {
    mockNext(jsonResponse({ status: "complete", messages: [] }));
    await makeClient().retryNode("m1", "n1", { force: true });
    expect(captured[0].url).toBe(
      "https://api.example.test/api/mindmaps/m1/nodes/n1/retry?force=true",
    );
  });

  it("retryNode forwards optional generation inputs as the body", async () => {
    mockNext(jsonResponse({ status: "complete", messages: [] }));
    await makeClient().retryNode("m1", "n1", { body: { modelId: "x" } });
    expect(captured[0].body).toEqual({ modelId: "x" });
  });

  it("interruptNode POSTs the interrupt path and returns the node", async () => {
    const node = { id: "n1", children: [], status: "interrupted" };
    mockNext(jsonResponse(node));
    const result = await makeClient().interruptNode("m1", "n1");
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe(
      "https://api.example.test/api/mindmaps/m1/nodes/n1/interrupt",
    );
    expect(result).toEqual(node);
  });
});

describe("error mapping", () => {
  it("throws ApiError carrying the status and parsed body", async () => {
    mockNext(jsonResponse({ error: "not found" }, 404));
    await expect(makeClient().getMap("missing")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      body: { error: "not found" },
    });
  });

  it("ApiError exposes the API error message", async () => {
    mockNext(jsonResponse({ error: "over budget" }, 429));
    let caught: unknown;
    try {
      await makeClient().submitNode("m1", "n1");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(429);
    expect((caught as ApiError).message).toContain("over budget");
  });

  it("handles non-JSON error bodies", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("upstream boom", { status: 500, headers: { "content-type": "text/plain" } }),
    );
    let caught: unknown;
    try {
      await makeClient().listMaps();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(500);
    expect((caught as ApiError).body).toBe("upstream boom");
  });
});

describe("token redaction", () => {
  it("never includes the token in ApiError output", async () => {
    mockNext(jsonResponse({ error: "boom" }, 500));
    let caught: unknown;
    try {
      await makeClient().listMaps();
    } catch (err) {
      caught = err;
    }
    const serialized = JSON.stringify(caught) + String(caught) + (caught as Error).stack;
    expect(serialized).not.toContain("secret-pat");
  });

  it("does not store the token on enumerable error fields", async () => {
    mockNext(jsonResponse({ error: "boom" }, 500));
    let caught: any;
    try {
      await makeClient().listMaps();
    } catch (err) {
      caught = err;
    }
    expect(JSON.stringify(Object.values(caught))).not.toContain("secret-pat");
  });
});
