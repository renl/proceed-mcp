# proceed-mcp

An MCP server that routes agent tool-approval requests to Telegram, so an operator can approve or deny an action from a chat client instead of a terminal prompt.

**Status: planned. Not implemented.**

This repository currently contains only this description. There is no code, no runtime, no configuration, and no published package. The intended first compatibility target is OpenCode V2.

## Planned scope

- Expose an MCP server that delivers approval requests to a Telegram chat.
- Accept approve/deny decisions from Telegram and return the decision to the requesting client.
- Target OpenCode V2 as the initial client.
