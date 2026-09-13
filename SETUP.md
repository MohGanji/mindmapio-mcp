# Setting up the Mindmap.io plugin

Instructions for Claude on first install. Follow them in order and stop as soon
as the connection works.

## 1. Check whether it already works

Call `list_maps`. If it returns (an empty list counts), the plugin is connected
and there is nothing to set up. Tell the person they are ready and stop here.

If the tools are not listed at all, the MCP server has not started yet. Ask the
person to restart Claude Code, then try again.

## 2. Get a token

Every call authenticates as the person's own mindmap.io account with a personal
access token.

Ask them to:

1. Open [mindmap.io](https://mindmap.io) and sign in.
2. Go to settings, then API access.
3. Generate a token and copy it. It is shown once.

Do not ask them to paste the token into the chat, and do not write it into any
file. If it does end up in the conversation, tell them to regenerate it in
settings, which revokes the old one immediately.

## 3. Give the plugin the token

Run `/plugin` and open this plugin's configuration. The token field is masked
and stored in the OS keychain, and Claude Code substitutes it into the MCP
server's environment. That is the only place it needs to go.

Restart Claude Code afterwards so the server picks it up.

If the person is not using the plugin, the same server runs from an MCP config
entry with the token in `MINDMAP_API_TOKEN`. The README has that configuration.

## 4. Confirm

Call `list_maps` again.

- It returns: the connection works. Say so, and offer to build something.
- `401`: the token is wrong or has been revoked. Generate a new one and repeat
  step 3.
- `403`: the token is valid but does not own the map being read. Nothing to fix
  in the setup.
- Still nothing: confirm Claude Code was restarted after the token was saved.

## After setup

Read the `map-shaping` skill before building a map. It covers where nodes go,
which is the part the tool schemas do not tell you.
