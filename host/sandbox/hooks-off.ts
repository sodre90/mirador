import type { Store } from "../store.ts";

/** How long the repository's hooks stay off in a workspace after its last sandboxed room's sandbox went. */
export const HOOKS_OFF_AFTER_SANDBOX_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether the owner's commit, land and new worktree in the workspace run without the repository's hooks: while a room
 * of it is sandboxed and for 7 days after, as its agents could have written hooks, or committed them, for those to run.
 */
export function repositoryHooksOff(store: Pick<Store, "listRooms" | "sandboxLastOnAt">, workspaceId: string, now = Date.now()) {
  if (store.listRooms().some((room) => room.workspaceId === workspaceId && room.sandbox.on)) return true;
  const lastOn = store.sandboxLastOnAt(workspaceId);
  return lastOn !== null && now - lastOn < HOOKS_OFF_AFTER_SANDBOX_MS;
}
