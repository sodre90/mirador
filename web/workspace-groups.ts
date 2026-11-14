import { useSyncExternalStore } from "react";

/** Folding is this browser's own, as pane layouts are: another window keeps its groups and workspaces as it had them. */
export function createFoldStore(storageKey: string) {
  const stored = (): Set<string> => {
    try {
      const ids: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
    } catch {
      return new Set();
    }
  };
  let folded = stored();
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  const save = (next: Set<string>) => {
    folded = next;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...folded]));
    } catch {}
    listeners.forEach((listener) => listener());
  };
  return {
    setFolded(id: string, fold: boolean) {
      if (folded.has(id) === fold) return;
      const next = new Set(folded);
      if (fold) next.add(id);
      else next.delete(id);
      save(next);
    },
    /** Forgets the folds of what no longer exists, so they don't pile up in the browser's storage. */
    keepOnly(existingIds: Iterable<string>) {
      const existing = new Set(existingIds);
      const kept = new Set([...folded].filter((id) => existing.has(id)));
      if (kept.size < folded.size) save(kept);
    },
    useFolded: () => useSyncExternalStore(subscribe, () => folded),
  };
}

const foldedGroups = createFoldStore("mirador-folded-workspace-groups");
export const setGroupFolded = foldedGroups.setFolded;
export const useFoldedGroups = foldedGroups.useFolded;

const foldedWorkspaces = createFoldStore("mirador-folded-workspaces");
export const setWorkspaceFolded = foldedWorkspaces.setFolded;
export const useFoldedWorkspaces = foldedWorkspaces.useFolded;

/** Callers whose delegated conversations the sidebar shows; the rest keep theirs folded away. */
const openedDelegations = createFoldStore("mirador-opened-delegations");
export const setDelegationsOpen = openedDelegations.setFolded;
export const useOpenedDelegations = openedDelegations.useFolded;

/** Once the host has said which workspaces, groups and conversations there are, the folds of deleted ones are dropped. */
export function forgetFoldsOfDeleted(workspaces: { id: string }[], groups: { id: string }[], conversations: { id: string }[]) {
  foldedWorkspaces.keepOnly(workspaces.map(({ id }) => id));
  foldedGroups.keepOnly(groups.map(({ id }) => id));
  openedDelegations.keepOnly(conversations.map(({ id }) => id));
}
