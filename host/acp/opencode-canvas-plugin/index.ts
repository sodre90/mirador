/**
 * An opencode 2 plugin, which opencode loads itself: Mirador names its folder in the agent's OPENCODE_CONFIG_CONTENT.
 * opencode 2 hands an MCP server's tools to the model inside Code Mode, one `execute` tool that runs scripts calling
 * them, unless the server is marked `codemode: false`, which ACP's `session/new` cannot say.
 */
type McpServer = { codemode?: boolean };
type McpServers = { get(name: string): McpServer | undefined; update(name: string, change: (server: McpServer) => void): void };
type PluginContext = { options: { server: string }; mcp: { transform(edit: (servers: McpServers) => void): Promise<unknown> } };

export default {
  id: "mirador.canvas-tools",
  async setup({ options, mcp }: PluginContext) {
    await mcp.transform((servers) => {
      if (servers.get(options.server)) servers.update(options.server, (server) => void (server.codemode = false));
    });
  },
};
