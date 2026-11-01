import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { offerRuns, offerSource, type PluginOffer } from "../../shared/apps.ts";
import type { PluginCatalog } from "../plugin-catalog.ts";
import { PLUGIN_INSTALL_TOOL } from "./guidance.ts";
import { INSTALL_ANSWER, type CanvasService } from "./service.ts";

const escaped = (text: string) => text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);

/** What installing the plugin brings, as Settings shows it before an install: where its code comes from and what of it runs. */
const offerHtml = (offer: PluginOffer) => `<p>${escaped(offerSource(offer))}</p><ul>${offerRuns(offer).map((line) => `<li>${escaped(line)}</li>`).join("")}</ul>`;

/** The install question: what the plugin does, where its code comes from and what of it runs, for the user to decide on. */
const aboutPlugin = (offer: PluginOffer, description: string, reason: string) =>
  `<h3>${escaped(offer.title)} ${escaped(offer.version)}</h3><p>${escaped(description)}</p><p><b>Why:</b> ${escaped(reason)}</p>${offerHtml(offer)}<p>An official Mirador plugin. Mirador builds it only if you answer Install, and uses it from its next restart.</p>`;

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
        const offer = await canvas.offerPlugin(plugin.name);
        canvas.openAsk(
          await callingConversation(ctx),
          {
            question: `Install the ${plugin.title} plugin?`,
            html: aboutPlugin(offer, plugin.description, reason),
            options: [
              { label: INSTALL_ANSWER, description: "Build it now; Mirador uses it from its next restart.", recommended: true },
              { label: "Not now", description: "Nothing is installed." },
            ],
          },
          { installsPluginOffer: offer.id },
        );
        return { content: [{ type: "text" as const, text: "The question is showing in the user's browser. Their answer, and whether the install went through, arrive as their next message. End your turn now." }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
      }
    },
  );
}
