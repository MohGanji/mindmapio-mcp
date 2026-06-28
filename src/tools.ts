import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { MindmapClient } from "./client.js";

/**
 * A semantic MCP tool over a single API primitive. `inputSchema` is a Zod raw
 * shape (rendered to JSON Schema by the MCP SDK); `handler` maps validated
 * arguments onto a client call. Handlers take the client as a parameter so the
 * wiring can be tested without a transport or a live server.
 */
export interface ToolDef {
  name: string;
  description: string;
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

const mapId = z.string().describe("The map id.");
const nodeId = z.string().describe("The node id (unprefixed, as returned in node trees).");

export function buildTools(): ToolDef[] {
  return [
    {
      name: "list_maps",
      description: "List the authenticated user's maps (metadata only, newest first).",
      inputSchema: {},
      handler: (client) => client.listMaps(),
    },
    {
      name: "get_map",
      description: "Read one full map including its complete node tree.",
      inputSchema: { mapId },
      handler: (client, args) => client.getMap(args.mapId),
    },
    {
      name: "get_node",
      description:
        "Read a single node without its descendants. Its children field still lists child ids for navigation.",
      inputSchema: { mapId, nodeId },
      handler: (client, args) => client.getNode(args.mapId, args.nodeId),
    },
    {
      name: "get_subtree",
      description:
        "Read a node and its descendants as a nested tree. Omit depth for the full subtree; 0 returns just the node.",
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
      description:
        "Create a map owned by the token's user. Pass an initial node tree in data so node primitives have a parent.",
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
      description: "Delete a map and all of its nodes.",
      inputSchema: { mapId },
      handler: (client, args) => client.deleteMap(args.mapId),
    },
    {
      name: "create_node",
      description:
        "Create a structural node under a parent. nodeId is optional; a uuid is minted when omitted so you can reference ids you choose.",
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
        text: z.string().optional().describe("Initial node text."),
        note: z.string().optional().describe("Initial node note."),
        nodeType: z.string().optional().describe("The node's type (e.g. prompt, data, expand)."),
      },
      handler: (client, args) => {
        const data = compact({ text: args.text, note: args.note, node_type: args.nodeType });
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
      description:
        "Apply a structural update to a node (text, note, type, collapsed flag, model). No LLM call, no metering.",
      inputSchema: {
        mapId,
        nodeId,
        text: z.string().optional(),
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
            text: args.text,
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
      description: "Delete a node and all of its descendants (cascade). The root node cannot be deleted.",
      inputSchema: { mapId, nodeId },
      handler: (client, args) => client.deleteNode(args.mapId, args.nodeId),
    },
    {
      name: "submit_node",
      description:
        "Run the LLM on a node and return the completed node. Blocks until ancestors finish; metered.",
      inputSchema: {
        mapId,
        nodeId,
        prompt: z
          .string()
          .optional()
          .describe("The node's user text when it has not been persisted yet; omit to run stored text."),
        modelId: z.string().optional().describe("Override the model (must be an exposed model)."),
      },
      handler: (client, args) =>
        client.submitNode(args.mapId, args.nodeId, compact({ prompt: args.prompt, modelId: args.modelId })),
    },
    {
      name: "auto_expand",
      description:
        "Generate follow-up prompts as queued child nodes and return their ids. One level only; submit each child yourself.",
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
      description:
        "Clear a node's error state and re-run its generation. Retrying an expand node with children needs force=true.",
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
      description:
        "Stop an in-flight generation; a generating or queued node flips to interrupted with partial output preserved. Idempotent.",
      inputSchema: { mapId, nodeId },
      handler: (client, args) => client.interruptNode(args.mapId, args.nodeId),
    },
  ];
}
