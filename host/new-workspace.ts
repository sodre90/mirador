import { basename } from "node:path";
import type { Workspace } from "../shared/model.ts";
import { isForBroughtAgents } from "./brought-agents.ts";
import { launchForNewWorkspace } from "./profiles.ts";
import type { Store } from "./store.ts";

/** A workspace of the folder, held to what brought agents are in a folder of theirs, whether the user adds it or a settings file does. */
export async function insertWorkspaceOf(folder: string, profileId: string | null, store: Store, dataDir: string): Promise<Workspace> {
  return store.insertWorkspace({
    id: crypto.randomUUID(),
    name: basename(folder) || folder,
    path: folder,
    defaultLaunch: launchForNewWorkspace(store, profileId),
    createdAt: Date.now(),
    ...((await isForBroughtAgents(dataDir, folder)) && { forBroughtAgents: true as const }),
  });
}
