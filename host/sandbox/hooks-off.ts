import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { ownerKey, roomSandbox, workspaceSandbox, type SandboxOwner } from "../../shared/sandbox.ts";
import type { Store } from "../store.ts";

/** How long the repositories' hooks stay off in a folder after the last sandbox that worked in it went. */
export const HOOKS_OFF_AFTER_SANDBOX_MS = 7 * 24 * 60 * 60 * 1000;

type SandboxedFolders = Pick<Store, "listWorkspaces" | "listRooms" | "foldersSandboxesLeft" | "writableSandboxFolders">;

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

/**
 * The folders sandboxes work in now: each sandboxed workspace's, the workspace's of each sandboxed room, and each folder
 * added read and write to a sandbox that is on.
 */
function foldersSandboxesWorkIn(store: SandboxedFolders) {
  const rooms = store.listRooms();
  const workspaces = store.listWorkspaces();
  const ofSandboxedRooms = new Set(rooms.flatMap(({ workspaceId, sandbox }) => (sandbox.on ? [workspaceId] : [])));
  const sandboxesOn = new Set([...rooms.filter(({ sandbox }) => sandbox.on).map(({ id }) => roomSandbox(id)), ...workspaces.filter(({ sandbox }) => sandbox.on).map(({ id }) => workspaceSandbox(id))].map(ownerKey));
  const writableFolders = store.writableSandboxFolders().flatMap(({ owner, path }) => (sandboxesOn.has(ownerKey(owner)) ? [path] : []));
  return [...workspaces.flatMap(({ id, path, sandbox }) => (sandbox.on || ofSandboxedRooms.has(id) ? [path] : [])), ...writableFolders];
}

/**
 * Whether the owner's commit, land and new worktree run without the repositories' hooks: in any of the folders that
 * lies in one a sandbox works in, while it does and for 7 days after, as its agents could have written hooks, or
 * committed them, for those to run. That takes in a repository or workspace nested in a sandboxed workspace, or in a
 * folder added read and write, whose `.git` its VM can write. A worktree goes by its workspace's folder too.
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

/** A sandbox no longer works in the folders added to it read and write, as it turns off or goes. */
export function sandboxLeftWritableFolders(store: Pick<Store, "setSandboxLeft" | "sandboxFoldersOf">, owner: SandboxOwner, now = Date.now()) {
  store
    .sandboxFoldersOf(owner)
    .filter(({ writable }) => writable)
    .forEach(({ path }) => sandboxLeft(store, path, now));
}
