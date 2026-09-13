#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
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
/** The package's own version, so the advertised one cannot drift from it. */
const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };

export function createServer(client: MindmapClient): McpServer {
  const server = new McpServer({ name: "mindmapio-mcp", version });

  for (const tool of buildTools()) {
    server.registerTool(
      tool.name,
      {
        title: tool.annotations.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
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

/**
 * Whether `moduleUrl` is the module the process was started on.
 *
 * The entry path has to be resolved through symlinks first. Every documented
 * install runs this package through a `node_modules/.bin` symlink (`npx -y
 * github:MohGanji/mindmapio-mcp`, `claude mcp add ... -- npx ...`, the plugin's
 * `.mcp.json`), and Node reports the *link* in `argv[1]` while `import.meta.url`
 * always carries the *real* path. Comparing the two raw makes the entry check
 * false and the server silently never starts — no output, exit code 0.
 */
export function isEntryModule(moduleUrl: string, entryPath: string | undefined): boolean {
  if (entryPath === undefined) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(entryPath)).href;
  } catch {
    // An entry path we cannot resolve is not this module.
    return false;
  }
}

if (isEntryModule(import.meta.url, argv[1])) {
  main().catch((err) => {
    // Never log the token; ApiError and config errors carry no secret.
    process.stderr.write(`mindmapio-mcp failed to start: ${formatError(err)}\n`);
    process.exit(1);
  });
}
