import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The plugins the trailer films, each a clean clone of its official repo at a release tag, kept in a cache so the capture
 * clones them once. The checklist and the code review come with Mirador, so they are linked in built, at the tags
 * plugins/defaults.json names; Media is the official plugin the agent recommends and installs on camera, and Delegate is
 * installed already, for the agent to hand a task to a local model.
 */
const cache = join(homedir(), ".cache", "mirador-video", "plugins");
const repoRoot = join(import.meta.dirname, "..", "..");

type Release = { name: string; repo: string; tag: string };

const comesWithMirador = () => (JSON.parse(readFileSync(join(repoRoot, "plugins", "defaults.json"), "utf8")) as { plugins: Release[] }).plugins;

export const MEDIA: Release = { name: "media", repo: "https://github.com/sodre90/mirador-media.git", tag: "v1.0.0" };
const DELEGATE: Release = { name: "delegate", repo: "https://github.com/sodre90/mirador-delegate.git", tag: "v0.3.1" };

const cachedClone = ({ name, tag }: Release) => join(cache, `${name}@${tag}`);

/**
 * The host's environment for git to clone Media from the cache: the catalog and the install question name its GitHub
 * repo, and installing it reaches GitHub only for its ffmpeg.
 */
export const MEDIA_FROM_CACHE = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${cachedClone(MEDIA)}.insteadOf`, GIT_CONFIG_VALUE_0: MEDIA.repo };

/** The official catalog as sodre90/mirador-plugins lists it. */
const catalog = {
  plugins: [
    {
      name: "media",
      title: "Media",
      description: "Edit a video or a photo with the agent: mark where something is wrong on the frame, and the agent trims, cuts, sets exposure, speed and volume, crops and turns it, then renders the result.",
      recommendWhen: "the user wants to edit a video or a photo, or to show you a moment or a spot in one",
      repo: MEDIA.repo,
    },
    {
      name: "google-docs",
      title: "Google Docs",
      description: "Edit a Google Doc with the agent: it proposes changes, comments and replies, you approve them or type in the doc yourself, and Send puts them in Docs as suggestions.",
      recommendWhen: "the user wants to write, edit or review a Google Doc, or answer its comments",
      repo: "https://github.com/sodre90/mirador-google-docs.git",
    },
    {
      name: "checklist",
      title: "Checklist",
      description: "A checklist of the steps of the agent's work beside the canvas, which the agent and the user tick as they go.",
      recommendWhen: "the work has several steps",
      repo: "https://github.com/sodre90/mirador-checklist.git",
    },
    {
      name: "review",
      title: "Code review",
      description: "Code reviews and guided tours of the code flow, with findings on the diff that the user keeps or drops and posts to the pull request.",
      recommendWhen: "the user wants code reviewed or explained",
      repo: "https://github.com/sodre90/mirador-review.git",
    },
  ],
};

/** A clone of the release, built when `built`; a clone half made by an interrupted run is made again. */
function cloned(release: Release, built: boolean) {
  const { repo, tag } = release;
  const folder = cachedClone(release);
  const ready = join(folder, built ? ".video-built" : ".video-cloned");
  if (existsSync(ready)) return folder;
  const partial = `${folder}.partial`;
  rmSync(partial, { recursive: true, force: true });
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(cache, { recursive: true });
  execFileSync("git", ["clone", "--quiet", "--branch", tag, repo, partial], { stdio: "inherit" });
  if (built) {
    const { build } = JSON.parse(readFileSync(join(partial, "plugin.json"), "utf8")) as { build?: string };
    if (build) execFileSync("sh", ["-c", build], { cwd: partial, stdio: "inherit" });
  }
  renameSync(partial, folder);
  writeFileSync(ready, "");
  return folder;
}

/** Links the plugins that come with Mirador, and Delegate, into the host's plugins folder, and writes the catalog for MIRADOR_PLUGIN_CATALOG. */
export function setUpPlugins(dataDir: string, catalogFile: string) {
  const plugins = join(dataDir, "plugins");
  mkdirSync(plugins, { recursive: true });
  for (const release of [...comesWithMirador(), DELEGATE]) symlinkSync(cloned(release, true), join(plugins, release.name));
  cloned(MEDIA, false);
  writeFileSync(catalogFile, JSON.stringify(catalog));
}
