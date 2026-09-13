import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import type { MindmapClient } from "./client.js";
import { loadSpec, readOperations, type McpAnnotations } from "./openapi.js";
import { ZOOM_LEVELS } from "./types.js";

/**
 * A semantic MCP tool over a single API primitive. `inputSchema` is a Zod raw
 * shape (rendered to JSON Schema by the MCP SDK); `handler` maps validated
 * arguments onto a client call. Handlers take the client as a parameter so the
 * wiring can be tested without a transport or a live server.
 *
 * `description` and `annotations` are NOT written here. They come from the
 * OpenAPI document, which is the enforced contract (ADR 0029) and documents
 * metering, the generation gate, the 409 on re-expanding and ownership — none
 * of which the hand-written copies carried. Two hand-maintained descriptions of
 * one contract is drift waiting to happen.
 */
export interface ToolDef {
  name: string;
  operationId: string;
  description: string;
  annotations: McpAnnotations;
  inputSchema: z.ZodRawShape;
  handler: (client: MindmapClient, args: any) => Promise<unknown>;
}

/**
 * What this file declares: the wiring for one tool, bound to the operation it
 * calls. `addendum` is for behaviour that belongs to the *tool* rather than the
 * endpoint (a minted id, links built client-side, a local file read) — never a
 * restatement of anything the document already says.
 */
interface ToolWiring {
  name: string;
  operationId: string;
  addendum?: string;
  inputSchema: z.ZodRawShape;
  handler: (client: MindmapClient, args: any) => Promise<unknown>;
}

/** Drop keys whose value is undefined so optional fields are never sent. */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

/**
 * The media types the upload endpoint accepts, keyed by file extension. The API
 * rejects anything else with a 415, so an unknown extension is worth catching
 * here where the message can say what is allowed.
 */
const UPLOADABLE: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

function mediaTypeOf(path: string): string {
  const mediaType = UPLOADABLE[extname(path).toLowerCase()];
  if (!mediaType) {
    throw new Error(
      `Cannot upload ${basename(path)}: the API accepts ${[...new Set(Object.values(UPLOADABLE))].join(", ")}.`,
    );
  }
  return mediaType;
}

const mapId = z.string().describe("The map id.");
const nodeId = z.string().describe("The node id (unprefixed, as returned in node trees).");

/**
 * Node content as a UIMessage array (Vercel AI SDK shape). Content is supplied
 * as messages, typically a single user turn whose text parts carry the prompt,
 * data, or note body.
 */
const messages = z
  .array(
    z.object({
      role: z.string().describe("The message role, usually 'user'."),
      parts: z
        .array(
          z.object({
            type: z.literal("text").describe("The part type; use 'text'."),
            text: z.string().describe("The text content of this part."),
          }),
        )
        .describe("Ordered content parts for this message."),
    }),
  )
  .describe("Node content as a UIMessage array (e.g. one user turn with text parts).");

function wiring(): ToolWiring[] {
  return [
    {
      name: "list_maps",
      operationId: "listMindmaps",
      inputSchema: {},
      handler: (client) => client.listMaps(),
    },
    {
      name: "get_map",
      operationId: "getMindmap",
      inputSchema: { mapId },
      handler: (client, args) => client.getMap(args.mapId),
    },
    {
      name: "get_node",
      operationId: "getNode",
      inputSchema: { mapId, nodeId },
      handler: (client, args) => client.getNode(args.mapId, args.nodeId),
    },
    {
      name: "get_subtree",
      operationId: "getSubtree",
      inputSchema: {
        mapId,
        nodeId,
        depth: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Maximum descendant levels to include."),
      },
      handler: (client, args) => client.getSubtree(args.mapId, args.nodeId, args.depth),
    },
    {
      name: "create_map",
      operationId: "createMap",
      inputSchema: {
        title: z.string().optional().describe("The map title."),
        kind: z.string().optional().describe("The map kind (defaults to mindmap)."),
        data: z
          .object({
            rootId: z.string().nullable().optional(),
            selectedId: z.string().nullable().optional(),
            nodes: z.record(z.string(), z.any()).optional(),
          })
          .passthrough()
          .optional()
          .describe("The initial node tree, with a root node."),
      },
      handler: (client, args) =>
        client.createMap(compact({ title: args.title, kind: args.kind, data: args.data })),
    },
    {
      name: "delete_map",
      operationId: "deleteMap",
      inputSchema: { mapId },
      handler: (client, args) => client.deleteMap(args.mapId),
    },
    {
      name: "publish_map",
      operationId: "publishMap",
      addendum:
        "This tool does both halves in one call: it publishes, then returns the ready-to-use links as {publicId, viewerUrl, embedUrl}, framed by the zoom and cz you pass.",
      inputSchema: {
        mapId,
        zoom: z
          .enum(ZOOM_LEVELS)
          .optional()
          .describe("Semantic zoom the links open at (default 'full'; 'keyword' for a zoomed-out reference map)."),
        cz: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Canvas zoom percent the links open at (default 100)."),
      },
      handler: async (client, args) => {
        const { publicId } = await client.publishMap(args.mapId);
        return client.publicMapUrls(publicId, compact({ zoom: args.zoom, cz: args.cz }));
      },
    },
    {
      name: "unpublish_map",
      operationId: "unpublishMap",
      inputSchema: { mapId },
      handler: (client, args) => client.unpublishMap(args.mapId),
    },
    {
      name: "create_node",
      operationId: "createNode",
      addendum:
        "nodeId is optional here: a uuid is minted when you omit it, so a whole branch can be laid out in one pass against ids you chose.",
      inputSchema: {
        mapId,
        nodeId: z
          .string()
          .optional()
          .describe("Client-minted node id, unique within the map. A uuid is generated if omitted."),
        parentId: z.string().describe("The id of an existing node to create this node under."),
        position: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe("Insert index among the parent's children; appended when omitted."),
        messages: messages
          .optional()
          .describe("Initial node content as a UIMessage array (a data/note node's body is a user message too)."),
        note: z.string().optional().describe("Initial node note."),
        nodeType: z.string().optional().describe("The node's type (e.g. prompt, data, expand)."),
      },
      handler: (client, args) => {
        const data = compact({ messages: args.messages, note: args.note, node_type: args.nodeType });
        const body = compact({
          nodeId: args.nodeId ?? randomUUID(),
          parentId: args.parentId,
          position: args.position,
          data: Object.keys(data).length > 0 ? data : undefined,
        });
        return client.createNode(args.mapId, body as any);
      },
    },
    {
      name: "update_node",
      operationId: "updateNode",
      inputSchema: {
        mapId,
        nodeId,
        messages: messages.optional().describe("Replace the node's content as a UIMessage array."),
        note: z.string().optional(),
        nodeType: z.string().optional().describe("Set or rotate the node's type."),
        isCollapsed: z.boolean().optional(),
        modelProvider: z.string().optional(),
        modelId: z.string().optional(),
      },
      handler: (client, args) =>
        client.updateNode(
          args.mapId,
          args.nodeId,
          compact({
            messages: args.messages,
            note: args.note,
            node_type: args.nodeType,
            is_collapsed: args.isCollapsed,
            model_provider: args.modelProvider,
            model_id: args.modelId,
          }),
        ),
    },
    {
      name: "delete_node",
      operationId: "deleteNode",
      inputSchema: { mapId, nodeId },
      handler: (client, args) => client.deleteNode(args.mapId, args.nodeId),
    },
    {
      name: "submit_node",
      operationId: "submitNode",
      inputSchema: {
        mapId,
        nodeId,
        prompt: z
          .string()
          .optional()
          .describe("The node's user text when it has not been persisted yet; omit to run stored text."),
        modelId: z.string().optional().describe("Override the model (must be an exposed model)."),
        force: z
          .boolean()
          .optional()
          .describe("Delete an expand node's existing children before re-running it, instead of failing with 409."),
      },
      handler: (client, args) =>
        client.submitNode(
          args.mapId,
          args.nodeId,
          compact({ prompt: args.prompt, modelId: args.modelId }),
          compact({ force: args.force }),
        ),
    },
    {
      name: "auto_expand",
      operationId: "autoExpandNode",
      inputSchema: {
        mapId,
        nodeId,
        count: z.number().int().min(1).max(4).optional().describe("Number of follow-ups (1-4, default 2)."),
        direction: z.string().optional().describe("Steers what the follow-ups explore."),
      },
      handler: (client, args) =>
        client.autoExpand(args.mapId, args.nodeId, compact({ count: args.count, direction: args.direction })),
    },
    {
      name: "retry_node",
      operationId: "retryNode",
      inputSchema: {
        mapId,
        nodeId,
        force: z
          .boolean()
          .optional()
          .describe("Delete an expand node's existing children before retrying instead of failing with 409."),
        prompt: z.string().optional(),
        modelId: z.string().optional(),
      },
      handler: (client, args) =>
        client.retryNode(args.mapId, args.nodeId, {
          force: args.force,
          body: compact({ prompt: args.prompt, modelId: args.modelId }),
        }),
    },
    {
      name: "interrupt_node",
      operationId: "interruptNode",
      inputSchema: { mapId, nodeId },
      handler: (client, args) => client.interruptNode(args.mapId, args.nodeId),
    },
    {
      name: "upload_attachment",
      operationId: "uploadAttachment",
      addendum:
        "Give this tool a path to a file on this machine; it reads the bytes and sends them. The media type comes from the extension (.png, .jpg/.jpeg, .webp, .gif, .pdf).",
      inputSchema: {
        mapId,
        path: z.string().describe("Path to the file on this machine."),
        filename: z
          .string()
          .optional()
          .describe("Name to store it under; the file's own name is used when omitted."),
      },
      // async so a rejected file type surfaces as a rejected promise, matching
      // every other handler, rather than throwing before one exists.
      handler: async (client, args) =>
        client.uploadAttachment(args.mapId, {
          bytes: readFileSync(args.path),
          mediaType: mediaTypeOf(args.path),
          filename: args.filename ?? basename(args.path),
        }),
    },
    {
      name: "read_attachment",
      operationId: "readAttachment",
      addendum:
        "This tool saves the bytes to a file on this machine and returns where it landed, so a large image or PDF is opened with your own file tools instead of being inlined. Without a path it writes to a temporary file.",
      inputSchema: {
        attachmentId: z
          .string()
          .describe("The attachment id (the last segment of the attachment's url)."),
        path: z
          .string()
          .optional()
          .describe("Where to save it; a temporary file is used when omitted."),
      },
      handler: async (client, args) => {
        const { bytes, mediaType } = await client.readAttachment(args.attachmentId);
        const path =
          args.path ?? join(mkdtempSync(join(tmpdir(), "mindmapio-")), args.attachmentId);
        writeFileSync(path, bytes);
        return { attachmentId: args.attachmentId, mediaType, size: bytes.byteLength, path };
      },
    },
  ];
}

/**
 * Build the tool list: local wiring (name, Zod schema, handler) joined to the
 * OpenAPI document (description, title, hints).
 *
 * The join is total in both directions and throws when it is not. An operation
 * with no tool is a capability agents cannot reach; a tool naming an operation
 * the document does not describe is a tool nobody reviewed. Both are the drift
 * this generation exists to remove, so neither is allowed to pass quietly.
 */
export function buildTools(spec: unknown = loadSpec()): ToolDef[] {
  const operations = readOperations(spec);
  const tools = wiring();

  const unknown = tools.filter((tool) => !operations.has(tool.operationId));
  if (unknown.length > 0) {
    throw new Error(
      `These tools name an operation the OpenAPI document does not describe: ${unknown
        .map((tool) => `${tool.name} -> ${tool.operationId}`)
        .join(", ")}.`,
    );
  }

  const covered = new Set(tools.map((tool) => tool.operationId));
  const uncovered = [...operations.keys()].filter((operationId) => !covered.has(operationId));
  if (uncovered.length > 0) {
    throw new Error(
      `The OpenAPI document describes operations with no MCP tool: ${uncovered.join(", ")}. ` +
        "Every documented operation is part of the agent contract; add a tool or stop documenting it.",
    );
  }

  return tools.map(({ name, operationId, addendum, inputSchema, handler }) => {
    const { description, ...annotations } = operations.get(operationId)!;
    return {
      name,
      operationId,
      description: addendum ? `${description}\n\n${addendum}` : description,
      annotations: {
        title: annotations.title,
        readOnlyHint: annotations.readOnlyHint,
        destructiveHint: annotations.destructiveHint,
      },
      inputSchema,
      handler,
    };
  });
}
