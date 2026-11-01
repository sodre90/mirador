import { expect, test } from "bun:test";
import type { ChangedFile, ChangeList } from "../shared/changes.ts";
import { fileTree, type TreeFolder, type TreeNode } from "../shared/file-tree.ts";
import { projectFilesWithChanges, startsFolded, type ListedFile } from "../web/changes.ts";

const treeOf = (paths: string[]) => fileTree(paths, (path) => path);

function outline(nodes: TreeNode<string>[], depth = 0): string[] {
  return nodes.flatMap((node) => {
    const line = `${"  ".repeat(depth)}${node.name}${node.kind === "folder" ? `/ (${node.path})` : ""}`;
    return node.kind === "folder" ? [line, ...outline(node.children, depth + 1)] : [line];
  });
}

test("nests files in their folders, folders before files and each sorted by name", () => {
  expect(outline(treeOf(["web/styles.css", "README.md", "web/Changes.tsx", "e2e/changes.spec.ts", "web/hints.ts", "e2e/a.spec.ts"]))).toEqual([
    "e2e/ (e2e)",
    "  a.spec.ts",
    "  changes.spec.ts",
    "web/ (web)",
    "  Changes.tsx",
    "  hints.ts",
    "  styles.css",
    "README.md",
  ]);
});

test("a folder holding only one folder shares its row with it", () => {
  expect(outline(treeOf(["host/changes/git/status.ts", "host/changes/git/diff.ts", "host/changes/list.ts", "web/a/b/c.ts"]))).toEqual([
    "host/changes/ (host/changes)",
    "  git/ (host/changes/git)",
    "    diff.ts",
    "    status.ts",
    "  list.ts",
    "web/a/b/ (web/a/b)",
    "  c.ts",
  ]);
});

test("a folder holding one folder and a file keeps its own row", () => {
  expect(outline(treeOf(["src/lib/x.ts", "src/index.ts"]))).toEqual(["src/ (src)", "  lib/ (src/lib)", "    x.ts", "  index.ts"]);
});

test("absolute paths start at the root, and paths under home at ~", () => {
  expect(outline(treeOf(["/etc/hosts", "/etc/ssh/config", "~/elsewhere/notes.md", "~/.zshrc"]))).toEqual([
    "/etc/ (/etc)",
    "  ssh/ (/etc/ssh)",
    "    config",
    "  hosts",
    "~/ (~)",
    "  elsewhere/ (~/elsewhere)",
    "    notes.md",
    "  .zshrc",
  ]);
});

test("Windows paths keep their backslashes", () => {
  expect(outline(treeOf(["C:\\Users\\ada\\notes.md", "C:\\Users\\ada\\todo\\list.md", "src\\app.ts"]))).toEqual([
    "C:\\Users\\ada/ (C:\\Users\\ada)",
    "  todo/ (C:\\Users\\ada\\todo)",
    "    list.md",
    "  notes.md",
    "src/ (src)",
    "  app.ts",
  ]);
});

test("a folder's items are every file under it, however deep, a compacted folder's those of its deepest part", () => {
  const [solo, web] = treeOf(["web/a.ts", "web/deep/b.ts", "web/deep/er/c.ts", "solo/only/d.ts", "other.ts"]);
  expect(web?.kind === "folder" && web.items.toSorted()).toEqual(["web/a.ts", "web/deep/b.ts", "web/deep/er/c.ts"]);
  expect(solo?.kind === "folder" && [solo.name, solo.items]).toEqual(["solo/only", ["solo/only/d.ts"]]);
});

test("keeps each file's own item", () => {
  const tree = fileTree([{ path: "a/b.ts", added: 3 }], ({ path }) => path);
  expect(tree[0]?.kind === "folder" && tree[0].children[0]).toEqual({ kind: "file", name: "b.ts", item: { path: "a/b.ts", added: 3 } });
});

const change = (path: string): ChangedFile => ({ path, status: "modified", added: 1, removed: 0, byAgent: false });
const list = (project: string[], committed: string[] = []): ChangeList => ({ scope: "turn", base: "turn-start", project: project.map(change), committed: committed.map(change), outside: [] });

test("every project file shows once: the changed ones with their changes, a commit's tagged, a deleted one though git no longer lists it", () => {
  const files = projectFilesWithChanges(list(["src/a.ts", "gone.ts"], ["pulled.ts"]), ["src/a.ts", "src/b.ts", "pulled.ts", "README.md"]);
  expect(files.map(({ path, change, fromCommit }) => [path, change !== null, fromCommit])).toEqual([
    ["src/a.ts", true, false],
    ["gone.ts", true, false],
    ["pulled.ts", true, true],
    ["src/b.ts", false, false],
    ["README.md", false, false],
  ]);
});

test("with every file shown only the folders holding a change start open; the changed files' tree starts all open", () => {
  const tree = fileTree(projectFilesWithChanges(list(["src/a.ts"]), ["src/a.ts", "docs/guide.md"]), ({ path }) => path);
  const folders = tree.filter((node): node is TreeFolder<ListedFile> => node.kind === "folder");
  expect(folders.map((folder) => [folder.name, startsFolded(folder, true), startsFolded(folder, false)])).toEqual([
    ["docs", true, false],
    ["src", false, false],
  ]);
});
