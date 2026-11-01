#!/usr/bin/env bun
/**
 * Writes into dist/ the files a self-updating Mirador fetches from the latest release, for each platform built there:
 * Electrobun's <prefix>-update.json, the app's archive, and a patch from each of the last releases that carry update
 * files. Usage: update-files.ts <dist> [--platform macos|linux|win]
 * With --platform, only that platform's builds; make release makes each platform's once its build is in.
 * On a Mac it packs the signed, stapled dist/signing/Mirador.app again, as Electrobun packs its archive before signing.
 * Each build's patches, one build to an update.json, are made in a process of its own, one build after another.
 * The Linux and Windows archives are Electrobun's own, which `make linux` and `make release` copy into dist/.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { RELEASES_REPOSITORY } from "../../shared/newer-version.ts";

const DESKTOP = join(import.meta.dir, "..");
const RELEASES_TO_PATCH_FROM = 5;

export interface UpdateManifest {
  channel: string;
  platform: string;
  arch: string;
  version: string;
  hash: string;
  artifact: { file: string };
}

export const updatePrefix = ({ channel, platform, arch }: UpdateManifest) => `${channel}-${platform}-${arch}`;
export const manifestFile = (prefix: string) => `${prefix}-update.json`;
export const patchFile = (prefix: string, fromHash: string) => `${prefix}-${fromHash}.patch`;
const MANIFEST_FILE = /^[a-z]+-(macos|linux|win)-[a-z0-9]+-update\.json$/;
const isManifestFile = (name: string) => MANIFEST_FILE.test(name);
export const PLATFORMS = ["macos", "linux", "win"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** The update files in dist/ of the builds for the platform, or of every build. */
export function manifestsOf(files: string[], platform?: Platform) {
  return files.filter((name) => {
    const builtFor = name.match(MANIFEST_FILE)?.[1];
    return builtFor !== undefined && (platform === undefined || builtFor === platform);
  });
}

export interface Releases {
  /** The newest first, drafts and prereleases left out. */
  recentTags(count: number): string[];
  assets(tag: string): string[];
  download(tag: string, asset: string, folder: string): string;
}

export interface Tools {
  decompress(archive: string, tar: string): void;
  compress(tar: string, archive: string): void;
  diff(oldTar: string, newTar: string, patch: string): void;
  /** Whether the patch turns the old archive into exactly the new one. */
  rebuilds(oldTar: string, patch: string, newTar: string): boolean;
}

const readManifest = (path: string) => JSON.parse(readFileSync(path, "utf8")) as UpdateManifest;

function inScratchFolder<Result>(work: (folder: string) => Result) {
  const folder = mkdtempSync(join(tmpdir(), "mirador-update-files-"));
  try {
    return work(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * A patch from each recent release whose files for this platform differ, made against the archive it published: that is
 * what its installs keep, byte for byte. Releases from before self-update carry no update files and are skipped.
 */
export function writePatches(dist: string, manifest: UpdateManifest, releases: Releases, tools: Tools, log: (line: string) => void = console.log) {
  const prefix = updatePrefix(manifest);
  readdirSync(dist)
    .filter((name) => name.startsWith(`${prefix}-`) && name.endsWith(".patch"))
    .forEach((stale) => rmSync(join(dist, stale)));
  inScratchFolder((folder) => {
    const newTar = join(folder, "new.tar");
    tools.decompress(join(dist, manifest.artifact.file), newTar);
    releases.recentTags(RELEASES_TO_PATCH_FROM).forEach((tag, index) => {
      if (!releases.assets(tag).includes(manifestFile(prefix))) return log(`${prefix}: ${tag} has no update files`);
      const releaseFolder = join(folder, `release-${index}`);
      const published = readManifest(releases.download(tag, manifestFile(prefix), releaseFolder));
      if (published.hash === manifest.hash) return log(`${prefix}: ${tag} is this build`);
      const oldTar = join(releaseFolder, "old.tar");
      tools.decompress(releases.download(tag, published.artifact.file, releaseFolder), oldTar);
      const patch = join(dist, patchFile(prefix, published.hash));
      tools.diff(oldTar, newTar, patch);
      if (!tools.rebuilds(oldTar, patch, newTar)) throw new Error(`The patch from ${tag} does not rebuild this build's archive.`);
      log(`${prefix}: patch from ${tag}, ${Math.ceil(statSync(patch).size / 1024)} KB`);
    });
  });
}

/** Refuses an app Apple has not accepted yet: the archive published now is what later releases patch from. */
export function packSignedMacApp(dist: string, builtManifest: UpdateManifest, tools: Tools) {
  const signing = join(dist, "signing");
  const app = join(signing, "Mirador.app");
  execFileSync("xcrun", ["stapler", "validate", app], { stdio: "inherit" });
  const { hash } = JSON.parse(readFileSync(join(app, "Contents", "Resources", "version.json"), "utf8")) as { hash: string };
  if (hash !== builtManifest.hash) throw new Error(`${app} is build ${hash}, but Electrobun's update.json describes build ${builtManifest.hash}.`);
  writeFileSync(join(dist, manifestFile(updatePrefix(builtManifest))), JSON.stringify(builtManifest));
  inScratchFolder((folder) => {
    const tar = join(folder, "app.tar");
    tarLikeElectrobun(signing, "Mirador.app", tar);
    tools.compress(tar, join(dist, builtManifest.artifact.file));
  });
}

/** As Electrobun's own archive: ustar, which its extractor reads, without extended attributes or AppleDouble files. */
const tarLikeElectrobun = (folder: string, entry: string, tar: string) =>
  execFileSync("tar", ["--no-xattrs", "--format=ustar", "-C", folder, "-cf", tar, entry], { env: { ...process.env, COPYFILE_DISABLE: "1" } });

function electrobunToolsFolder() {
  const lock = join(DESKTOP, ".hutch", "dependencies.lock");
  if (!existsSync(lock)) throw new Error(`${lock} is missing: build the desktop app first.`);
  const { objects } = JSON.parse(readFileSync(lock, "utf8")) as { objects: { type: string; relativeRoot: string }[] };
  const electrobun = objects.find((object) => object.type === "electrobun");
  if (!electrobun) throw new Error(`${lock} names no Electrobun release.`);
  return join(homedir(), ".hutch", electrobun.relativeRoot);
}

/**
 * Electrobun's own zstd and bsdiff, of the release the app is built with, so patches match the bspatch inside the app.
 * Their progress reports stay out of the way, and in the error when one fails.
 */
export function electrobunTools(folder = electrobunToolsFolder()): Tools {
  const run = (tool: string, args: string[]) => execFileSync(join(folder, tool), args, { stdio: ["ignore", "ignore", "pipe"] });
  return {
    decompress: (archive, tar) => run("zig-zstd", ["decompress", "-i", archive, "-o", tar, "--no-timing"]),
    compress: (tar, archive) => run("zig-zstd", ["compress", "-i", tar, "-o", archive, "--no-timing"]),
    diff: (oldTar, newTar, patch) => run("bsdiff", [oldTar, newTar, patch]),
    rebuilds: (oldTar, patch, newTar) => {
      const rebuilt = `${patch}.rebuilt`;
      try {
        run("bspatch", [oldTar, rebuilt, patch]);
        return spawnSync("cmp", ["-s", rebuilt, newTar]).status === 0;
      } finally {
        rmSync(rebuilt, { force: true });
      }
    },
  };
}

const gh = (args: string[]) => execFileSync("gh", [...args, "--repo", RELEASES_REPOSITORY], { encoding: "utf8" });

export const githubReleases: Releases = {
  recentTags: (count) =>
    (JSON.parse(gh(["release", "list", "--exclude-drafts", "--exclude-pre-releases", "--limit", String(count), "--json", "tagName"])) as { tagName: string }[]).map(
      ({ tagName }) => tagName,
    ),
  assets: (tag) => (JSON.parse(gh(["release", "view", tag, "--json", "assets"])) as { assets: { name: string }[] }).assets.map(({ name }) => name),
  download: (tag, asset, folder) => {
    gh(["release", "download", tag, "--pattern", asset, "--dir", folder]);
    return join(folder, asset);
  },
};

const PATCHES_FOR = "--patches-for";
const PLATFORM = "--platform";

function platformOf(option: string | undefined, value: string | undefined) {
  if (option === undefined) return undefined;
  if (option !== PLATFORM || !PLATFORMS.includes(value as Platform)) throw new Error(`Usage: update-files.ts <dist> [${PLATFORM} ${PLATFORMS.join("|")}]`);
  return value as Platform;
}

/** bsdiff takes many times an archive's size in memory, so a build's patches are made one after another. */
async function writePatchesForEachBuild(dist: string, manifests: string[]) {
  const failed: string[] = [];
  for (const name of manifests) {
    const patching = Bun.spawn([process.execPath, import.meta.path, dist, PATCHES_FOR, name], { stdio: ["ignore", "inherit", "inherit"] });
    if ((await patching.exited) !== 0) failed.push(name);
  }
  if (failed.length > 0) throw new Error(`The patches for ${failed.join(", ")} failed.`);
}

if (import.meta.main) {
  const [dist, option, value] = process.argv.slice(2);
  if (!dist) throw new Error(`Usage: update-files.ts <dist> [${PLATFORM} ${PLATFORMS.join("|")}]`);
  const tools = electrobunTools();
  if (option === PATCHES_FOR) {
    writePatches(dist, readManifest(join(dist, value!)), githubReleases, tools);
  } else {
    const platform = platformOf(option, value);
    const signedApp = existsSync(join(dist, "signing", "Mirador.app"));
    if (platform === "macos" && !signedApp) throw new Error(`No signed app in ${join(dist, "signing")}: run make macos-signed first.`);
    if (signedApp && (platform === undefined || platform === "macos")) {
      const artifacts = join(DESKTOP, "artifacts");
      const built = readdirSync(artifacts).filter((name) => isManifestFile(name) && name.includes("-macos-"));
      if (built.length !== 1) throw new Error(`Expected one macOS update.json in ${artifacts}, found ${built.length}.`);
      packSignedMacApp(dist, readManifest(join(artifacts, built[0]!)), tools);
    }
    const manifests = manifestsOf(readdirSync(dist), platform);
    if (manifests.length === 0) throw new Error(`No ${platform ? `${platform} ` : ""}update files in ${dist}: build the apps first.`);
    await writePatchesForEachBuild(dist, manifests);
  }
}
