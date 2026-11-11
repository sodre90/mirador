import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CanvasHost, PluginBackgroundContext } from "../../../../shared/canvas-plugins.ts";

const LOOKS_EVERY_MS = 250;

/** Starts one conversation in each workspace whose folder holds a "start-in-background" file, on the profile it names. */
function startWhereAsked(context: PluginBackgroundContext) {
  for (const { id, folder } of context.workspaces()) {
    const workspace = context.inWorkspace(id);
    const asking = join(folder, "start-in-background");
    if (workspace.storage.get("started") || !existsSync(asking)) continue;
    workspace.storage.set("started", true);
    workspace.startConversation({ profile: readFileSync(asking, "utf8").trim(), prompt: "Started in the background", title: "Background start" }).catch((error) => console.error("the starter couldn't start a conversation:", error));
  }
}

/** Background work that starts conversations where a workspace asks, and a tab that starts one on the profile the user picks. */
const host: CanvasHost = {
  items: {},
  tools: {},
  background(context) {
    setInterval(() => startWhereAsked(context), LOOKS_EVERY_MS);
  },
  workspaceTab: {
    state: ({ profiles }) => ({ profiles: profiles().map(({ name }) => name) }),
    action: (action, { startConversation }) => startConversation({ profile: (action as { profile: string }).profile, prompt: "Check the results", title: "Results" }),
  },
};

export default host;
