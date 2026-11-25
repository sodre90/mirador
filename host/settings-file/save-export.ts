import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { FileAlreadyThere, SaveRefused } from "../canvas/save-to-project.ts";
import { homePath } from "./home-path.ts";

const expandHomeWith = (path: string, home: string) => {
  if (path === "~") return home;
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(home, path.slice(2));
  return path;
};

/** Writes exported settings to a chosen file on this machine, readable only by this user. */
export async function saveExportedSettings(
  path: string,
  text: string,
  { replace = false, home = homedir() } = {},
): Promise<string> {
  const name = path.trim();
  if (name === "") throw new SaveRefused({ code: "save-needs-name" });
  const target = resolve(home, expandHomeWith(name, home));
  const shown = homePath(target, home);
  const existing = await stat(target).catch(() => undefined);
  if (existing?.isDirectory()) throw new SaveRefused({ code: "export-path-is-folder", name: shown });
  if (existing && !replace) throw new FileAlreadyThere({ code: "save-already-there", path: shown });

  await mkdir(dirname(target), { recursive: true }).catch(() => {
    throw new SaveRefused({ code: "save-path-part-is-file", name: shown });
  });
  if (existing) await chmod(target, 0o600);
  await writeFile(target, text, { mode: 0o600 });
  return shown;
}
