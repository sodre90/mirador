import { realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import type { WorkspaceIcon } from "../shared/workspace-icon.ts";
import { checkedIcon, MAX_ICON_BYTES, refused, TOO_LARGE, type CheckedIcon } from "./icon-image.ts";

const projectFolders = [".mirador", ".idea"];
const namedIn = (folder: string, name: string, extensions: string[]) => extensions.map((extension) => join(folder, `${name}.${extension}`));

const projectIcons = (folder: string) => namedIn(folder, "icon", ["svg", "png"]);
const darkProjectIcons = (folder: string) => namedIn(folder, "icon_dark", ["svg", "png"]);

/** As web projects keep the icon of their pages. */
const pageIcons = [...["", "public", "static"].flatMap((folder) => namedIn(folder, "favicon", ["svg", "ico", "png"])), ...namedIn("app", "icon", ["svg", "ico", "png"])];

const lightIcons = [...projectFolders.flatMap(projectIcons), ...pageIcons];
const darkIcons = [...projectFolders.flatMap((folder) => [...darkProjectIcons(folder), ...projectIcons(folder)]), ...pageIcons];

/** What the file there gives, null when there is none. A repository someone else made may hold links out of the workspace. */
async function iconAt(realFolder: string, path: string): Promise<CheckedIcon | null> {
  const real = await realpath(join(realFolder, path)).catch(() => null);
  if (real === null) return null;
  if (!real.startsWith(realFolder + sep)) return refused("it leads out of the workspace");
  try {
    const found = await stat(real);
    if (!found.isFile()) return refused("it is no file");
    return found.size > MAX_ICON_BYTES ? refused(TOO_LARGE) : checkedIcon(await Bun.file(real).slice(0, MAX_ICON_BYTES).bytes());
  } catch {
    return refused("it can't be read");
  }
}

type CheckedIcons = Map<string, CheckedIcon | null>;

function firstShown(candidates: string[], icons: CheckedIcons) {
  const path = candidates.find((candidate) => icons.get(candidate)?.dataUrl);
  const passedOver = path === undefined ? candidates : candidates.slice(0, candidates.indexOf(path));
  return { dataUrl: (path !== undefined && icons.get(path)?.dataUrl) || null, passedOver };
}

const logRefusals = (folder: string, paths: string[], icons: CheckedIcons) =>
  [...new Set(paths)].forEach((path) => {
    const refusal = icons.get(path)?.refusal;
    if (refusal) console.error(`${join(folder, path)} isn't shown as its workspace's icon: ${refusal}`);
  });

/** The icon a workspace's folder holds, as IntelliJ IDEA finds a project's own, or as its web pages name theirs. */
export async function workspaceIcon(folder: string): Promise<WorkspaceIcon | null> {
  const realFolder = await realpath(folder).catch(() => null);
  if (realFolder === null) return null;
  const paths = [...new Set([...lightIcons, ...darkIcons])];
  const icons: CheckedIcons = new Map(await Promise.all(paths.map(async (path) => [path, await iconAt(realFolder, path)] as const)));
  const { dataUrl: light, passedOver: passedOverInLight } = firstShown(lightIcons, icons);
  const { dataUrl: dark, passedOver: passedOverInDark } = firstShown(darkIcons, icons);
  logRefusals(folder, [...passedOverInLight, ...passedOverInDark], icons);
  return light || dark ? { light, dark: dark === light ? null : dark } : null;
}
