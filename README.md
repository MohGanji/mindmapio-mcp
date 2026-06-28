# mindmapio-mcp

Drive [Mindmap.io](https://mindmap.io) maps from an AI agent. This package wraps
the Mindmap.io unified node API (ADR 0021) so external agents can read maps and
nodes, build subtrees with client-minted ids, and run the generative node
operations: submit, auto-expand, retry, and interrupt.

Two ways to use it:

1. **MCP server** — run `npx -y mindmapio-mcp` and point any MCP client at it.
2. **Agent skill** — drive the HTTP API directly, no MCP client required. See
   [`skill/SKILL.md`](skill/SKILL.md).

## Get a token

Every call authenticates with a personal access token (PAT):

1. Open Mindmap.io → settings → API access.
2. Generate a token and copy it (you only see it once).
3. Export it as `MINDMAP_API_TOKEN`, or paste it into your MCP client config.

The token acts as its user. Regenerating it immediately revokes the old one.

## Install path 1: MCP server

The server speaks MCP over stdio. Add this to your MCP client config (Claude
Desktop, Cursor, etc.) — `npx` fetches and runs the published package:

```json
{
  "mcpServers": {
    "mindmapio": {
      "command": "npx",
      "args": ["-y", "mindmapio-mcp"],
      "env": {
        "MINDMAP_API_TOKEN": "<your personal access token>"
      }
    }
  }
}
```

### Configuration

| Env var | Required | Default | Description |
| --- | --- | --- | --- |
| `MINDMAP_API_TOKEN` | yes | — | Personal access token, sent as `Authorization: Bearer <token>`. Never logged. |
| `MINDMAP_API_BASE_URL` | no | `https://mindmap.io` | API base URL. |

### Tools

One tool per API primitive:

| Tool | API | Notes |
| --- | --- | --- |
| `list_maps` | `GET /api/mindmaps` | Metadata only, newest first. |
| `get_map` | `GET /api/mindmaps/{id}` | Full map including the node tree. |
| `get_node` | `GET /api/mindmaps/{mapId}/nodes/{nodeId}` | One node; its `children` lists child ids. |
| `get_subtree` | `GET .../nodes/{nodeId}/subtree?depth` | Nested tree; omit `depth` for the full subtree, `0` for just the node. |
| `create_map` | `POST /api/mindmaps` | Pass an initial `data` tree with a root node. |
| `delete_map` | `DELETE /api/mindmaps/{id}` | Cascades to all nodes. |
| `create_node` | `POST /api/mindmaps/{mapId}/nodes` | `nodeId` optional; a uuid is minted when omitted. |
| `update_node` | `PATCH .../nodes/{nodeId}` | Structural only; no LLM call, no metering. |
| `delete_node` | `DELETE .../nodes/{nodeId}` | Cascades to descendants; root cannot be deleted. |
| `submit_node` | `POST .../nodes/{nodeId}/submit` | Runs the LLM; blocks on ancestors; metered. |
| `auto_expand` | `POST .../nodes/{nodeId}/auto-expand` | Queues 1–4 follow-up children; submit each yourself. |
| `retry_node` | `POST .../nodes/{nodeId}/retry?force` | Re-run a failed node; `force` to re-expand. |
| `interrupt_node` | `POST .../nodes/{nodeId}/interrupt` | Stop an in-flight node; idempotent; not metered. |

`create_node` accepts an optional `nodeId`; a uuid is minted when omitted, so an
agent can reference ids it chose while building a subtree before they persist.

## Install path 2: agent skill

Prefer to call the HTTP API directly without an MCP client? Install the bundled
skill at [`skill/SKILL.md`](skill/SKILL.md). It teaches an agent the same
primitives as curl calls, including the agent-drives-recursion pattern for
auto-expand (call `auto_expand`, then `submit` each returned child).

```bash
export MINDMAP_API_TOKEN="<your personal access token>"
export MINDMAP_API_BASE_URL="https://mindmap.io"   # optional, the default
```

## Hello world

Create a map, add a prompt node, run it, and read it back. With the MCP server,
call the tools in order; the arguments for each are:

```jsonc
// 1. Create a map with a root node.
create_map   { "title": "Hello", "data": { "rootId": "root",
               "nodes": { "root": { "id": "root", "text": "Hello", "children": [] } } } }
//   -> { "id": "MAP_ID" }

// 2. Create a prompt node under the root.
create_node  { "mapId": "MAP_ID", "nodeId": "q1", "parentId": "root",
               "text": "Say hi in one word.", "nodeType": "prompt" }

// 3. Run the node; the call blocks until the answer is ready.
submit_node  { "mapId": "MAP_ID", "nodeId": "q1" }
//   -> { "nodeId": "q1", "status": "complete", "messages": [ ... ] }

// 4. Read it back.
get_node     { "mapId": "MAP_ID", "nodeId": "q1" }
```

See [`skill/SKILL.md`](skill/SKILL.md) for the curl equivalents.

## Security

- **Never commit your token.** Keep it in your MCP client config or an
  environment variable, not in source control.
- The token is sent only as the `Authorization` bearer header and is never
  logged: config and API errors carry no secret.
- Treat the PAT like a password. If it leaks, regenerate it in settings, which
  revokes the old one immediately.

## Develop

```bash
npm install
npm test        # vitest against a mocked HTTP layer (no live backend needed)
npm run build   # tsc -> dist/
```

## License

[MIT](LICENSE)
