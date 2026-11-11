import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

/** A stdio MCP server with one tool, `reload_probe`, for specs that add a server to an agent's settings and look for its tool. */
const server = new McpServer({ name: "reload-probe", version: "1.0.0" });
server.registerTool("reload_probe", { description: "Says that the agent picked up the reload-probe MCP server" }, () => ({ content: [{ type: "text", text: "picked up" }] }));
await server.connect(new StdioServerTransport());
