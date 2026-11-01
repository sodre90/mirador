import { afterEach, beforeEach, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifestsOf, patchFile, writePatches, type Releases, type Tools, type UpdateManifest } from "../desktop/scripts/update-files.ts";

const manifest = (version: string, hash: string): UpdateManifest => ({
  channel: "stable",
  platform: "linux",
  arch: "x64",
  version,
  hash,
  artifact: { file: "stable-linux-x64-Mirador.tar.zst" },
});
const PREFIX = "stable-linux-x64";
const THIS_BUILD = manifest("0.6.0", "newhash");

let root: string;
let dist: string;
let published: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mirador-update-files-test-"));
  dist = join(root, "dist");
  published = join(root, "published");
  mkdirSync(dist);
  writeFileSync(join(dist, "stable-linux-x64-update.json"), JSON.stringify(THIS_BUILD));
  writeFileSync(join(dist, THIS_BUILD.artifact.file), "app 0.6.0");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Each release's assets as files in a folder of its own, the newest first. */
function publish(tag: string, assets: Record<string, string>) {
  mkdirSync(join(published, tag), { recursive: true });
  Object.entries(assets).forEach(([name, content]) => writeFileSync(join(published, tag, name), content));
}
const withUpdateFiles = (release: UpdateManifest, archive: string) => ({ "stable-linux-x64-update.json": JSON.stringify(release), [release.artifact.file]: archive });

function releases(tags: string[]): Releases & { askedFor: number[] } {
  const askedFor: number[] = [];
  return {
    askedFor,
    recentTags: (count) => {
      askedFor.push(count);
      return tags.slice(0, count);
    },
    assets: (tag) => readdirSync(join(published, tag)),
    download: (tag, asset, folder) => {
      mkdirSync(folder, { recursive: true });
      copyFileSync(join(published, tag, asset), join(folder, asset));
      return join(folder, asset);
    },
  };
}

/** Archives stand for their tars, and a patch records what it was made from and into. */
const tools = (rebuilds = true): Tools => ({
  decompress: (archive, tar) => copyFileSync(archive, tar),
  compress: (tar, archive) => copyFileSync(tar, archive),
  diff: (oldTar, newTar, patch) => writeFileSync(patch, `${readFileSync(oldTar, "utf8")} -> ${readFileSync(newTar, "utf8")}`),
  rebuilds: () => rebuilds,
});

const patchesIn = (folder: string) => readdirSync(folder).filter((name) => name.endsWith(".patch")).sort();

test("a patch from each recent release with update files, made against the archive it published and named by its build", () => {
  publish("v0.5.1", withUpdateFiles(manifest("0.5.1", "hash051"), "app 0.5.1"));
  publish("v0.5.0", withUpdateFiles(manifest("0.5.0", "hash050"), "app 0.5.0"));
  publish("v0.4.0", { "Mirador-linux-x64-Setup.tar.gz": "installer" });
  const lines: string[] = [];

  writePatches(dist, THIS_BUILD, releases(["v0.5.1", "v0.5.0", "v0.4.0"]), tools(), (line) => lines.push(line));

  expect(patchesIn(dist)).toEqual([patchFile(PREFIX, "hash050"), patchFile(PREFIX, "hash051")]);
  expect(readFileSync(join(dist, patchFile(PREFIX, "hash051")), "utf8")).toBe("app 0.5.1 -> app 0.6.0");
  expect(readFileSync(join(dist, patchFile(PREFIX, "hash050")), "utf8")).toBe("app 0.5.0 -> app 0.6.0");
  expect(lines).toContain("stable-linux-x64: v0.4.0 has no update files");
});

test("patches come from the last five releases only", () => {
  const tags = ["v0.9.0", "v0.8.0", "v0.7.0", "v0.6.2", "v0.6.1", "v0.5.0"];
  tags.forEach((tag) => publish(tag, withUpdateFiles(manifest(tag.slice(1), `hash-${tag}`), `app ${tag}`)));
  const recent = releases(tags);

  writePatches(dist, THIS_BUILD, recent, tools(), () => {});

  expect(recent.askedFor).toEqual([5]);
  expect(patchesIn(dist)).toHaveLength(5);
  expect(existsSync(join(dist, patchFile(PREFIX, "hash-v0.5.0")))).toBe(false);
});

test("a release that is this very build, published again, gets no patch", () => {
  publish("v0.6.0", withUpdateFiles(THIS_BUILD, "app 0.6.0"));

  writePatches(dist, THIS_BUILD, releases(["v0.6.0"]), tools(), () => {});

  expect(patchesIn(dist)).toEqual([]);
});

test("the update files of one platform's builds, or of every build", () => {
  const dist = [
    "stable-macos-arm64-update.json",
    "stable-linux-x64-update.json",
    "stable-linux-arm64-update.json",
    "stable-win-x64-update.json",
    "stable-linux-x64-abc.patch",
    "Mirador-linux-x64-Setup.tar.gz",
    "install.sh",
  ];
  expect(manifestsOf(dist)).toEqual(["stable-macos-arm64-update.json", "stable-linux-x64-update.json", "stable-linux-arm64-update.json", "stable-win-x64-update.json"]);
  expect(manifestsOf(dist, "linux")).toEqual(["stable-linux-x64-update.json", "stable-linux-arm64-update.json"]);
  expect(manifestsOf(dist, "win")).toEqual(["stable-win-x64-update.json"]);
  expect(manifestsOf(dist, "macos")).toEqual(["stable-macos-arm64-update.json"]);
});

test("patches left from an earlier run for this platform go, other platforms' stay", () => {
  writeFileSync(join(dist, patchFile(PREFIX, "gone")), "stale");
  writeFileSync(join(dist, patchFile("stable-linux-arm64", "kept")), "other platform");

  writePatches(dist, THIS_BUILD, releases([]), tools(), () => {});

  expect(patchesIn(dist)).toEqual([patchFile("stable-linux-arm64", "kept")]);
});

test("a patch that does not rebuild this build's archive stops the run", () => {
  publish("v0.5.0", withUpdateFiles(manifest("0.5.0", "hash050"), "app 0.5.0"));

  expect(() => writePatches(dist, THIS_BUILD, releases(["v0.5.0"]), tools(false), () => {})).toThrow("The patch from v0.5.0 does not rebuild this build's archive.");
});
