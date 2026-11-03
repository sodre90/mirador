import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CanvasHost, WorkspaceTabContext } from "../../../../shared/canvas-plugins.ts";

const countIn = (storage: WorkspaceTabContext["storage"]) => (typeof storage.get("count") === "number" ? (storage.get("count") as number) : 0);

/** A workspace tab that counts the user's presses for each workspace and across them, shown only where the folder holds no "untallied" file. */
const host: CanvasHost = {
  items: {},
  tools: {},
  workspaceTab: {
    shows: ({ workspace }) => !existsSync(join(workspace.folder, "untallied")),
    state: async ({ workspace, storage, sharedStorage }) => ({ workspace: workspace.name, count: countIn(storage), everywhere: countIn(sharedStorage) }),
    action(action, { storage, sharedStorage, changed }) {
      if ((action as { kind?: unknown }).kind !== "count") throw new Error("The tally can only count.");
      storage.set("count", countIn(storage) + 1);
      sharedStorage.set("count", countIn(sharedStorage) + 1);
      changed();
      return { counted: countIn(storage) };
    },
  },
};

export default host;
