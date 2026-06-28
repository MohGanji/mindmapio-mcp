# mindmapio-mcp

Give your AI agent a place to build and keep what it learns. Connect it to [mindmap.io](https://mindmap.io) and it turns research, plans, and conversations into a real map you can open, grow, and share. Your agent reads existing maps, adds and edits nodes, runs prompts on them, and fans any topic out into follow-up questions, all through your own mindmap.io account.

Two ways to set it up:

1. **MCP server.** One line in your MCP client config (Claude Desktop, Cursor, and other MCP clients).
2. **Agent skill.** Install it with `npx skills` so your agent works with mindmap.io directly, no MCP client needed.

## Get a token

Every call uses a personal access token from your account.

1. Open mindmap.io, go to settings, then API access.
2. Generate a token and copy it. You only see it once.
3. Save it as `MINDMAP_API_TOKEN`, or paste it into your MCP client config.

The token acts as you. Regenerate it any time and the old one stops working instantly.

## Option 1: MCP server

Add this to your MCP client config. `npx` fetches and runs the package for you:

```json
{
  "mcpServers": {
    "mindmapio": {
      "command": "npx",
      "args": ["-y", "github:MohGanji/mindmapio-mcp"],
      "env": {
        "MINDMAP_API_TOKEN": "<your personal access token>"
      }
    }
  }
}
```

With the Claude Code CLI, the same thing in one line:

```bash
claude mcp add mindmapio --env MINDMAP_API_TOKEN=<your token> -- npx -y github:MohGanji/mindmapio-mcp
```

The first run builds from source, so it takes a few extra seconds. Later runs are cached.

### Settings

| Env var | Required | Default | What it does |
| --- | --- | --- | --- |
| `MINDMAP_API_TOKEN` | yes | — | Your personal access token. Sent as `Authorization: Bearer <token>`. Never logged. |
| `MINDMAP_API_BASE_URL` | no | `https://mindmap.io` | API base URL. |

### What your agent can do

| Tool | What it does |
| --- | --- |
| `list_maps` | List your maps, newest first. |
| `get_map` | Read a whole map and its node tree. |
| `get_node` | Read one node. |
| `get_subtree` | Read a node and its children, as deep as you want. |
| `create_map` | Start a new map. |
| `delete_map` | Delete a map and everything in it. |
| `create_node` | Add a node under a parent. |
| `update_node` | Edit a node's text, note, type, or model. |
| `delete_node` | Remove a node and its children. |
| `submit_node` | Run a node through the model and get the answer back. |
| `auto_expand` | Turn a node into follow-up questions for your agent to run. |
| `retry_node` | Re-run a node that failed. |
| `interrupt_node` | Stop a node that is still running. |

`create_node` mints a node id for you when you leave it out, so your agent can lay out a whole branch in one pass.

## Option 2: agent skill

Install the skill with one command:

```bash
npx skills add MohGanji/mindmapio-mcp
```

This works with Claude Code and other agents that support skills (browse them at [skills.sh](https://www.skills.sh)). It teaches your agent the same actions over plain HTTP, including how to expand a node into follow-up questions and run each one. You can also read it directly at [`skills/mindmapio/SKILL.md`](skills/mindmapio/SKILL.md).

Set your token first:

```bash
export MINDMAP_API_TOKEN="<your personal access token>"
```

## Hello world

Create a map, add a question, run it, and read the answer. With the MCP server, call the tools in order:

```jsonc
// 1. Create a map with a root node.
create_map   { "title": "Hello", "data": { "rootId": "root",
               "nodes": { "root": { "id": "root", "text": "Hello", "children": [] } } } }
//   -> { "id": "MAP_ID" }

// 2. Add a question under the root.
create_node  { "mapId": "MAP_ID", "nodeId": "q1", "parentId": "root",
               "text": "Say hi in one word.", "nodeType": "prompt" }

// 3. Run it. The call waits until the answer is ready.
submit_node  { "mapId": "MAP_ID", "nodeId": "q1" }
//   -> { "nodeId": "q1", "status": "complete", "messages": [ ... ] }

// 4. Read it back.
get_node     { "mapId": "MAP_ID", "nodeId": "q1" }
```

The skill at [`skills/mindmapio/SKILL.md`](skills/mindmapio/SKILL.md) shows the same flow as curl commands.

## Keep your token safe

- Never commit your token. Keep it in your MCP client config or an environment variable.
- It is sent only as the `Authorization` header and is never logged. Config and error messages carry no secret.
- Treat it like a password. If it leaks, regenerate it in settings and the old one stops working right away.

## Develop

```bash
npm install
npm test        # vitest against a mocked HTTP layer, no live backend needed
npm run build   # tsc -> dist/
```

## License

[MIT](LICENSE)
