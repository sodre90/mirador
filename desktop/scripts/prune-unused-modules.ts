#!/usr/bin/env bun
/**
 * Removes from a staged Mirador's node_modules what it never loads, which is most of their size: the packages only
 * mermaid needs, as the canvas serves one self-contained file of mermaid's; three.js's sources, as it serves the built
 * files; and every package's source maps and type declarations.
 */
import { existsSync, readdirSync, readFileSync, rmdirSync, rmSync } from "node:fs";
import { join, normalize, relative } from "node:path";

/** What host/canvas/assets.ts serves of mermaid, with what resolving the package and its licence need. */
export const MERMAID_FILES_KEPT = ["package.json", "LICENSE", "dist/mermaid.min.js"];
const UNSERVED_FOLDERS = ["three/src"];
const NEVER_LOADED = /\.(js|mjs|cjs|css|ts|mts|cts)\.map$|\.d\.[mc]?ts$/;

type Manifest = Partial<Record<"dependencies" | "optionalDependencies" | "peerDependencies", Record<string, string>>>;

function manifestIn(folder: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

const dependenciesOf = (manifest: Manifest) =>
  [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies].flatMap((each) => Object.keys(each ?? {}));

/** The installed packages `roots` need, themselves included. */
export function packagesNeededBy(modules: string, roots: string[]): Set<string> {
  const needed = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const name = pending.pop()!;
    const manifest = needed.has(name) ? null : manifestIn(join(modules, name));
    if (!manifest) continue;
    needed.add(name);
    pending.push(...dependenciesOf(manifest));
  }
  return needed;
}

export function packagesOnlyMermaidNeeds(modules: string, appDependencies: string[]) {
  const neededByTheRest = packagesNeededBy(
    modules,
    appDependencies.filter((name) => name !== "mermaid"),
  );
  return [...packagesNeededBy(modules, ["mermaid"])].filter((name) => !neededByTheRest.has(name));
}

const entriesUnder = (folder: string) => readdirSync(folder, { recursive: true, withFileTypes: true });
const filesUnder = (folder: string) =>
  entriesUnder(folder)
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
const deadLinksUnder = (folder: string) =>
  entriesUnder(folder)
    .filter((entry) => entry.isSymbolicLink())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((link) => !existsSync(link));

function removeEmptyFolders(folder: string) {
  entriesUnder(folder)
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort((one, other) => other.length - one.length)
    .forEach((each) => readdirSync(each).length === 0 && rmdirSync(each));
}

function keepOnly(folder: string, kept: string[]) {
  const keptPaths = kept.map(normalize);
  filesUnder(folder)
    .filter((file) => !keptPaths.includes(relative(folder, file)))
    .forEach((file) => rmSync(file));
}

export function pruneUnusedModules(stage: string) {
  const modules = join(stage, "node_modules");
  packagesOnlyMermaidNeeds(modules, dependenciesOf(manifestIn(stage) ?? {}))
    .filter((name) => name !== "mermaid")
    .forEach((name) => rmSync(join(modules, name), { recursive: true, force: true }));
  keepOnly(join(modules, "mermaid"), MERMAID_FILES_KEPT);
  UNSERVED_FOLDERS.forEach((folder) => rmSync(join(modules, folder), { recursive: true, force: true }));
  filesUnder(modules)
    .filter((file) => NEVER_LOADED.test(file))
    .forEach((file) => rmSync(file));
  deadLinksUnder(modules).forEach((link) => rmSync(link));
  removeEmptyFolders(modules);
}

if (import.meta.main) pruneUnusedModules(process.argv[2] ?? process.cwd());
