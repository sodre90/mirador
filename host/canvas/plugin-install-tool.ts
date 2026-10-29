import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { PluginCatalog } from "../plugin-catalog.ts";
import { PLUGIN_INSTALL_TOOL } from "./guidance.ts";
import { INSTALL_ANSWER, type CanvasService } from "./service.ts";

const escaped = (text: string) => text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);

/** The install question: what the plugin does and where its code comes from, for the user to decide on. */
const aboutPlugin = ({ title, description, repo }: { title: string; description: string; repo: string }, reason: string) =>
  `<h3>${escaped(title)}</h3><p>${escaped(description)}</p><p><b>Why:</b> ${escaped(reason)}</p><p>Mirador clones and builds <code>${escaped(repo)}</code>, an official Mirador plugin, and uses it from its next restart.</p>`;

/** The agent asks to install an official plugin; Mirador installs it only once the user answers Install. */
export function registerPluginInstallTool(server: McpServer, catalog: PluginCatalog, canvas: CanvasService, callingConversation: (ctx: ServerContext) => Promise<string>) {
  server.registerTool(
    PLUGIN_INSTALL_TOOL,
    {
      description:
        "Ask the user to install an official Mirador plugin you recommended, by its name from the list in the canvas server's instructions. The user sees a question with what the plugin does and where it comes from; Mirador installs it only if they answer Install. Their answer, and whether the install went through, arrive as their next message: end your turn after calling this.",
      inputSchema: z.object({
        name: z.string().min(1).describe("The plugin's name, as the list of official plugins gives it, e.g. media."),
        reason: z.string().min(1).describe("One sentence on why it helps with what the user is doing now."),
      }),
    },
    async ({ name, reason }, ctx) => {
      try {
        const plugin = catalog.installable(name);
        canvas.openAsk(
          await callingConversation(ctx),
          {
            question: `Install the ${plugin.title} plugin?`,
            html: aboutPlugin(plugin, reason),
            options: [
              { label: INSTALL_ANSWER, description: "Clone and build it now; Mirador uses it from its next restart.", recommended: true },
              { label: "Not now", description: "Nothing is installed." },
            ],
          },
          { installsPlugin: plugin.name },
        );
        return { content: [{ type: "text" as const, text: "The question is showing in the user's browser. Their answer, and whether the install went through, arrive as their next message. End your turn now." }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
      }
    },
  );
}
