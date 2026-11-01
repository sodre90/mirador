# Spike: canvas MCP server behind three ACP harnesses (2026-09-30)

Throwaway code. One Bun process (`src/host.ts`) serves a canvas MCP server with a blocking `ask` tool plus a bare browser page. `src/run.ts` drives one harness over ACP, injects the canvas server through `session/new` `mcpServers`, and checks that the answer reaches the agent.

## Setup per harness

| Harness | ACP entry point | Model used in the spike |
|---|---|---|
| Claude Code | `@agentclientprotocol/claude-agent-acp` 0.84.0 | Haiku 4.5 via `_meta.claudeCode.options.model` |
| opencode 1.18.18 | `opencode acp` | `sp-fleet/qwen38-flash-next-sp` via `OPENCODE_CONFIG_CONTENT` |
| pi 0.84.4 | `@liuser/pi-acp` 0.2.0 + `@liuser/pi-mcp-adapter` (installed in the isolated `.pi-agent/`) | `sp-fleet/qwen38-flash-next-sp` |

The original `pi-acp` 0.0.34 reports `mcpCapabilities.http: false`, so it cannot receive our server.

## Results

| | Claude Code | opencode | pi |
|---|---|---|---|
| Accepts injected HTTP MCP server | yes | yes | yes |
| MCP protocol era | 2026-07-28 | 2025-11-25 | 2025-11-25 |
| One `createMcpHandler` serves it | yes | yes | yes |
| Asks the ACP client for permission | yes | no (auto-allows) | no |
| Blocking `ask`, default settings | fails at 60 s | fails at 60 s | fails at 60 s |
| Sends a progress token | yes | yes | yes |
| Progress heartbeat (15 s) keeps it alive | yes, 21 min tested | yes, 21 min tested | no |
| Fix for pi | | | `settings.requestTimeoutMs` in `<pi agent dir>/mcp.json` (1 h set, 150 s tested) |

## Other observations

- pi exposes our tool only through the adapter's generic `mcp` proxy tool. The model needed about 5 calls (search, connect, describe) before calling it. A native pi extension would register `ask` as a real tool.
- `pi-acp` forwards progress messages as agent text chunks, so the UI must filter them.
- Two `opencode acp` processes started at the same moment fail with `database is locked`. The host should keep one opencode process and open several sessions on it.
- Claude Code SDK options such as `model`, `settings` and `env` pass through `_meta.claudeCode.options`. `settings.disableAllHooks` kept the user's claude-notifier hooks from firing.
- MCP TS SDK v2 tool handlers get `ctx.mcpReq.signal`, which aborts when the client gives up. The host uses it to withdraw the question from the browser.

## Not covered

- The browser half never ran. Every answer was the host's auto-answer (`?auto=…&answer=…`), so the page, the WebSocket answer path, the Origin check and the sandboxed previews are untested.
- pi's fix ran only in the isolated `.pi-agent/`, which lacks the user's own pi packages. Using it for real means installing the `@liuser` fork plus the timeout in the global `~/.pi/agent`. That is one more reason for a native pi extension.
- Making opencode ask for permission was not tested.
- In every run the prompt told the agent to call `ask`. Whether agents use `show` or `ask` on their own is untested. Claude Code only found the tool through ToolSearch, and it has its own AskUserQuestion competing with ours.

## Reproduce

```
bun src/host.ts                  # 127.0.0.1:4545, page at /
bun src/run.ts claude 150        # agent: claude | opencode | pi-acp-liuser ; seconds before auto-answer
```
