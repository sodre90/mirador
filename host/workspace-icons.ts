import { realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import type { WorkspaceIcon } from "../shared/workspace-icon.ts";
import { iconDataUrl, MAX_ICON_BYTES } from "./icon-image.ts";

const projectFolders = [".mirador", ".idea"];
const namedIn = (folder: string, name: string, extensions: string[]) => extensions.map((extension) => join(folder, `${name}.${extension}`));

const projectIcons = (folder: string) => namedIn(folder, "icon", ["svg", "png"]);
const darkProjectIcons = (folder: string) => namedIn(folder, "icon_dark", ["svg", "png"]);

/** As web projects keep the icon of their pages. */
const pageIcons = [...["", "public", "static"].flatMap((folder) => namedIn(folder, "favicon", ["svg", "ico", "png"])), ...namedIn("app", "icon", ["svg", "ico", "png"])];

const lightIcons = [...projectFolders.flatMap(projectIcons), ...pageIcons];
const darkIcons = [...projectFolders.flatMap((folder) => [...darkProjectIcons(folder), ...projectIcons(folder)]), ...pageIcons];

/** The file's bytes, unless it leads out of the workspace: a repository someone else made may hold links. */
async function bytesInside(realFolder: string, path: string): Promise<Uint8Array | null> {
  const real = await realpath(join(realFolder, path));
  const found = await stat(real);
  if (!real.startsWith(realFolder + sep) || !found.isFile() || found.size > MAX_ICON_BYTES) return null;
  return Bun.file(real).slice(0, MAX_ICON_BYTES).bytes();
}

async function iconAt(realFolder: string, path: string): Promise<string | null> {
  const bytes = await bytesInside(realFolder, path).catch(() => null);
  return bytes && iconDataUrl(bytes);
}

/** The icon a workspace's folder holds, as IntelliJ IDEA finds a project's own, or as its web pages name theirs. */
export async function workspaceIcon(folder: string): Promise<WorkspaceIcon | null> {
  const realFolder = await realpath(folder).catch(() => null);
  if (realFolder === null) return null;
  const paths = [...new Set([...lightIcons, ...darkIcons])];
  const icons = new Map(await Promise.all(paths.map(async (path) => [path, await iconAt(realFolder, path)] as const)));
  const firstOf = (candidates: string[]) => candidates.map((path) => icons.get(path)).find(Boolean) ?? null;
  const light = firstOf(lightIcons);
  const dark = firstOf(darkIcons);
  return light || dark ? { light, dark: dark === light ? null : dark } : null;
}
