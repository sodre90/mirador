export interface TreeFolder<T> {
  kind: "folder";
  /** A folder holding nothing but one folder shares its row with it, so its name can span several, as `src/lib`. */
  name: string;
  path: string;
  children: TreeNode<T>[];
  /** Every item under the folder, however deep, gathered once as the tree is built. */
  items: T[];
}

export interface TreeFile<T> {
  kind: "file";
  name: string;
  item: T;
}

export type TreeNode<T> = TreeFolder<T> | TreeFile<T>;

const separatorOf = (path: string) => (path.includes("\\") ? "\\" : "/");

function pathSegments(path: string, separator: string): string[] {
  const [first = "", ...rest] = path.split(separator === "\\" ? /[\\/]/ : "/");
  return [first === "" ? separator : first, ...rest.filter(Boolean)];
}

const joined = (parent: string, name: string, separator: string) => (parent === "" ? name : parent.endsWith(separator) ? `${parent}${name}` : `${parent}${separator}${name}`);

/** The items nested in the folders of their paths, folders before files and each sorted by name. Paths may be relative or absolute, with / or \ between their parts. */
export function fileTree<T>(items: readonly T[], pathOf: (item: T) => string): TreeNode<T>[] {
  const root: TreeFolder<T> = { kind: "folder", name: "", path: "", children: [], items: [] };
  for (const item of items) {
    const path = pathOf(item);
    const separator = separatorOf(path);
    const segments = pathSegments(path, separator);
    const fileName = segments.pop()!;
    const folder = segments.reduce((parent, name) => {
      const child = childFolder(parent, name, separator);
      child.items.push(item);
      return child;
    }, root);
    folder.children.push({ kind: "file", name: fileName, item });
  }
  return compacted(sorted(root.children));
}

function childFolder<T>(parent: TreeFolder<T>, name: string, separator: string): TreeFolder<T> {
  const existing = parent.children.find((child): child is TreeFolder<T> => child.kind === "folder" && child.name === name);
  if (existing) return existing;
  const created: TreeFolder<T> = { kind: "folder", name, path: joined(parent.path, name, separator), children: [], items: [] };
  parent.children.push(created);
  return created;
}

function sorted<T>(nodes: TreeNode<T>[]): TreeNode<T>[] {
  return nodes
    .map((node) => (node.kind === "folder" ? { ...node, children: sorted(node.children) } : node))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1));
}

function compacted<T>(nodes: TreeNode<T>[]): TreeNode<T>[] {
  return nodes.map((node) => (node.kind === "folder" ? compactedFolder(node) : node));
}

function compactedFolder<T>(folder: TreeFolder<T>): TreeFolder<T> {
  const [only, ...others] = folder.children;
  if (only?.kind === "folder" && others.length === 0) return compactedFolder({ ...only, name: joined(folder.name, only.name, separatorOf(only.path)) });
  return { ...folder, children: compacted(folder.children) };
}
