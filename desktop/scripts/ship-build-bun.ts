/**
 * Electrobun ships the Bun it pins as the app's main process, and the app runs its host on that Bun too. These put the
 * build machine's Bun, the one Mirador's checks run on, in its place.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, readdirSync, readFileSync, realpathSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, join, sep } from "node:path";

/** Where the Bun is inside an app Electrobun built, by the system it is for. */
const BUN_IN_APP: Record<string, string[]> = {
  macos: ["Contents", "MacOS", "bun"],
  linux: ["bin", "bun"],
  win: ["bin", "bun.exe"],
};

export const BUN_PROGRAM = process.platform === "win32" ? "bun.exe" : "bun";
const CHECKOUT = join(import.meta.dir, "..", "..");

/** The Bun Mirador is checked and released on, named once for every build, check and workflow. */
export const definedBunVersion = (checkout = CHECKOUT) => readFileSync(join(checkout, ".bun-version"), "utf8").trim();

/** `bun run` puts a folder of its own first on the PATH, and on Windows it holds a link to the running Bun in a temporary folder. */
const isBunRunFolder = (folder: string) => basename(folder).startsWith("bun-node-");

/** The first on the PATH, else where Bun's installer puts it. */
export function buildMachineBun(path = process.env.PATH ?? "", home = homedir()) {
  const folders = path.split(delimiter).filter((folder) => folder !== "" && !isBunRunFolder(folder));
  const onPath = folders.map((folder) => join(folder, BUN_PROGRAM)).find(existsSync);
  const bun = onPath ?? join(home, ".bun", "bin", BUN_PROGRAM);
  if (realpathSync(bun).startsWith(join(realpathSync(home), ".hutch") + sep)) throw new Error(`${bun} is the Bun Electrobun pins, not the build machine's`);
  return bun;
}

export function bunInApp(buildFolder: string, system: string) {
  const inApp = BUN_IN_APP[system];
  if (!inApp) throw new Error(`Where Electrobun puts Bun in an app for ${system} is not known yet`);
  const entries = readdirSync(buildFolder);
  const found = entries.map((entry) => join(buildFolder, entry, ...inApp)).filter(existsSync);
  if (found.length !== 1) throw new Error(`Expected one app with Bun in ${buildFolder}, found ${found.length} among: ${entries.join(", ")}`);
  return found[0]!;
}

const versionOf = (bun: string) => execFileSync(bun, ["--version"], { encoding: "utf8" }).trim();

/** A release carries the Bun its checks ran on, so it is built with no other. */
export function requireDefinedBun(bun: string, defined = definedBunVersion()) {
  const version = versionOf(bun);
  if (version !== defined) throw new Error(`${bun} is Bun ${version}, but .bun-version names ${defined}, the Bun a release is checked on and carries`);
}

/**
 * The new file takes the old one's name rather than being written into it, which would also change every other link to
 * it. Electrobun's own is kept when it is the same version, as on Windows it carries the app's icon.
 */
export function shipBuildBun(buildFolder: string, system: string, buildBun: string) {
  const appBun = bunInApp(buildFolder, system);
  const pinned = versionOf(appBun);
  if (pinned === versionOf(buildBun)) return { appBun, pinned, shipped: pinned };
  const incoming = `${appBun}.incoming`;
  copyFileSync(buildBun, incoming);
  chmodSync(incoming, statSync(appBun).mode);
  renameSync(incoming, appBun);
  const shipped = versionOf(appBun);
  const built = versionOf(buildBun);
  if (shipped !== built) throw new Error(`The app's Bun reports ${shipped} after the swap, the build machine's ${built}`);
  return { appBun, pinned, shipped };
}
