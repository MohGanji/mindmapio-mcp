#!/usr/bin/env node
import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiError, MindmapClient } from "./client.js";
import { buildTools } from "./tools.js";

/**
 * Build an MCP server exposing one tool per Mindmap.io API primitive. Each tool
 * delegates to the shared client; results are returned as JSON text content and
 * API errors are surfaced as tool errors (the bearer token is never included).
 */
export function createServer(client: MindmapClient): McpServer {
  const server = new McpServer({ name: "mindmapio-mcp", version: "0.1.0" });

  for (const tool of buildTools()) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: unknown) => {
        try {
          const result = await tool.handler(client, args ?? {});
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: formatError(err) }],
          };
        }
      },
    );
  }

  return server;
}

function formatError(err: unknown): string {
  if (err instanceof ApiError) {
    return `API error ${err.status}: ${JSON.stringify(err.body)}`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  const client = new MindmapClient();
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirectRun = argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href;

if (isDirectRun) {
  main().catch((err) => {
    // Never log the token; ApiError and config errors carry no secret.
    process.stderr.write(`mindmapio-mcp failed to start: ${formatError(err)}\n`);
    process.exit(1);
  });
}
