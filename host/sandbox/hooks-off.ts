import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import type { Store } from "../store.ts";

/** How long the repositories' hooks stay off in a folder after the last sandbox that worked in it went. */
export const HOOKS_OFF_AFTER_SANDBOX_MS = 7 * 24 * 60 * 60 * 1000;

type SandboxedFolders = Pick<Store, "listWorkspaces" | "listRooms" | "foldersSandboxesLeft">;

const realOrAsIs = (path: string) => {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
};

const isInside = (folder: string, outer: string) => {
  const inside = relative(outer, folder);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside));
};

/** The folders sandboxes work in now: each sandboxed workspace's, and the workspace's of each sandboxed room. */
function foldersSandboxesWorkIn(store: SandboxedFolders) {
  const ofSandboxedRooms = new Set(store.listRooms().flatMap(({ workspaceId, sandbox }) => (sandbox.on ? [workspaceId] : [])));
  return store.listWorkspaces().flatMap(({ id, path, sandbox }) => (sandbox.on || ofSandboxedRooms.has(id) ? [path] : []));
}

/**
 * Whether the owner's commit, land and new worktree run without the repositories' hooks: in any of the folders that
 * lies in one a sandbox works in, while it does and for 7 days after, as its agents could have written hooks, or
 * committed them, for those to run. That takes in a repository or workspace nested in a sandboxed workspace, whose
 * `.git` its VM can write. A worktree goes by its workspace's folder too.
 */
export function repositoryHooksOff(store: SandboxedFolders, folders: string[], now = Date.now()) {
  const leftLately = store.foldersSandboxesLeft().flatMap(({ path, leftAt }) => (now - leftAt < HOOKS_OFF_AFTER_SANDBOX_MS ? [path] : []));
  const reached = [...foldersSandboxesWorkIn(store), ...leftLately].map(realOrAsIs);
  return folders.map(realOrAsIs).some((folder) => reached.some((sandboxed) => isInside(folder, sandboxed)));
}

/** A sandbox no longer works in the folder: the repositories in it keep their hooks off for 7 days from now. */
export function sandboxLeft(store: Pick<Store, "setSandboxLeft">, folder: string, now = Date.now()) {
  store.setSandboxLeft(realOrAsIs(folder), now);
}
