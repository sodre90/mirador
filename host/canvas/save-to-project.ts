import { lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { toPosix } from "../paths.ts";
import { HostProblemError } from "../../shared/host-problems.ts";

export class SaveRefused extends HostProblemError {}

export class FileAlreadyThere extends SaveRefused {}

const HTML_NAME = /\.html?$/i;
const IMAGE_NAME = /\.png$/i;

const escapes = (relativePath: string) => relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);

const isWithin = (root: string, path: string) => !escapes(relative(root, path));

const isInside = (root: string, path: string) => relative(root, path) !== "" && isWithin(root, path);

const outsideWorkspace = (name: string) => new SaveRefused({ code: "save-path-outside", name });

const statOf = (path: string) => stat(path).catch(() => undefined);

/** A link on the way can lead out of the workspace, so the real place of the nearest existing entry decides. */
async function realPlaceOf(path: string): Promise<string> {
  const exists = await lstat(path).then(() => true, () => false);
  return exists ? realpath(path) : realPlaceOf(dirname(path));
}

async function assertNotLeadingOut(root: string, target: string, name: string) {
  const realLocation = await realPlaceOf(target).catch(() => undefined);
  if (realLocation === undefined || !isWithin(root, realLocation)) throw outsideWorkspace(name);
}

export async function saveIntoWorkspace(workspaceRoot: string, path: string, content: string | Uint8Array, { replace = false } = {}): Promise<string> {
  const savesHtml = typeof content === "string";
  const name = path.trim();
  if (name === "") throw new SaveRefused({ code: "save-needs-name" });
  if (isAbsolute(name)) throw new SaveRefused({ code: "save-path-absolute", name });

  const root = await realpath(workspaceRoot);
  const target = resolve(root, name);
  if (!isInside(root, target)) throw outsideWorkspace(name);
  await assertNotLeadingOut(root, target, name);
  if (!(savesHtml ? HTML_NAME : IMAGE_NAME).test(name)) throw new SaveRefused({ code: savesHtml ? "save-as-html" : "save-as-png" });

  const existing = await statOf(target);
  if (existing?.isDirectory()) throw new SaveRefused({ code: "save-path-is-folder", name });
  const saved = toPosix(relative(root, target));
  if (existing && !replace) throw new FileAlreadyThere({ code: "save-already-there", path: saved });

  await mkdir(dirname(target), { recursive: true }).catch(() => {
    throw new SaveRefused({ code: "save-path-part-is-file", name });
  });
  await writeFile(target, content);
  return saved;
}
