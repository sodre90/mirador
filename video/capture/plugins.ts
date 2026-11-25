import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The plugins the trailer and GIFs film, each a clean clone of its official repo at a release tag, cached once in
 * ~/.cache/mirador-video/plugins. Checklist, Code review, Delegate and Media are linked in built so scenes start
 * cleanly with zero network install waits, while the official catalog populates the Plugins… Discover gallery.
 */
const cache = join(homedir(), ".cache", "mirador-video", "plugins");
const repoRoot = join(import.meta.dirname, "..", "..");

type Release = { name: string; repo: string; tag: string };

const comesWithMirador = () => (JSON.parse(readFileSync(join(repoRoot, "plugins", "defaults.json"), "utf8")) as { plugins: Release[] }).plugins;

export const MEDIA: Release = { name: "media", repo: "https://github.com/sodre90/mirador-media.git", tag: "v1.1.4" };
const DELEGATE: Release = { name: "delegate", repo: "https://github.com/sodre90/mirador-delegate.git", tag: "v0.4.4" };

const cachedClone = ({ name, tag }: Release) => join(cache, `${name}@${tag}`);

export const MEDIA_FROM_CACHE = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${cachedClone(MEDIA)}.insteadOf`, GIT_CONFIG_VALUE_0: MEDIA.repo };

/** Rich offline snapshot of sodre90/mirador-plugins so Plugins… shows real official icons, taglines and releases. */
const catalog = {
  plugins: [
    {
      name: "media",
      title: "Media",
      tagline: "Mark what's wrong on a frame; the agent trims, cuts and crops the video or photo.",
      description: "Edit a video or a photo with the agent: mark where something is wrong on the frame, and the agent trims, cuts, sets exposure, speed and volume, crops and turns it, then renders the result.",
      kinds: ["app"],
      recommendWhen: "the user wants to edit a video or a photo",
      repo: MEDIA.repo,
      release: "1.1.4",
      commit: "978acf811aefa077652894f16a20f65b6882b9ff",
      api: 2,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#e5484d"/><rect x="12" y="18" width="40" height="28" rx="4" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="M28 25v14l11-7z" fill="#fff"/></svg>`,
    },
    {
      name: "delegate",
      title: "Delegate",
      tagline: "Hand easy tasks to a conversation on another profile, such as a local model.",
      description: "Hand a self-contained task to another agent profile in the same workspace and get the answer back automatically.",
      kinds: ["canvas"],
      recommendWhen: "the user wants to delegate a task to another profile",
      repo: DELEGATE.repo,
      release: "0.4.4",
      commit: "563b8e164362b98b734ab2eee180ffe3bde3ea74",
      api: 15,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#d97706"/><path d="M18 22h20l-6-6m6 6-6 6M46 42H26l6-6m-6 6 6 6" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    },
    {
      name: "review",
      title: "Code review",
      tagline: "Code reviews and guided tours of the code, with findings on the diff.",
      description: "Code reviews and guided tours of the code flow, with findings on the diff that the user keeps or drops and posts to the pull request.",
      kinds: ["canvas"],
      recommendWhen: "the user wants code reviewed or explained",
      repo: "https://github.com/sodre90/mirador-review.git",
      release: "1.0.14",
      commit: "0a71c240809e35f5b4d94b3a06d47fd653febdfb",
      api: 3,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#6e56cf"/><path d="M20 22h24M20 32h18M20 42h12" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><path d="M39 42l5 5 10-12" fill="none" stroke="#34d399" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    },
    {
      name: "checklist",
      title: "Checklist",
      tagline: "The steps of the agent's work beside the canvas, ticked as they get done.",
      description: "A checklist of the steps of the agent's work beside the canvas, which the agent and the user tick as they go.",
      kinds: ["canvas"],
      recommendWhen: "the work has several steps",
      repo: "https://github.com/sodre90/mirador-checklist.git",
      release: "1.0.6",
      commit: "db96375471067cf1d740971c1acdce65c945a546",
      api: 3,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#059669"/><path d="M18 22l4 4 7-8M34 23h14M18 40l4 4 7-8M34 41h14" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    },
    {
      name: "race",
      title: "Race",
      tagline: "Several agents race one task, each in a worktree of its own; take the best work.",
      description: "Several agents race one task in parallel git worktrees; compare their work and take the winner or combine the best parts.",
      kinds: ["canvas"],
      recommendWhen: "the user wants several agents to race one task",
      repo: "https://github.com/sodre90/mirador-race.git",
      release: "0.5.5",
      commit: "1111111111111111111111111111111111111111",
      api: 18,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#ec4899"/><path d="M16 44L26 20l10 14 12-16" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="48" cy="18" r="4" fill="#fde047"/></svg>`,
    },
    {
      name: "spectra-council",
      title: "Spectra Council",
      tagline: "Several models review your code on their own, then argue out each finding.",
      description: "Several models review your code or documents independently and debate each finding before presenting the verdict.",
      kinds: ["canvas"],
      recommendWhen: "the user wants a multi-model review",
      repo: "https://github.com/sodre90/spectra-council.git",
      release: "0.4.1",
      commit: "2222222222222222222222222222222222222222",
      api: 18,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4f46e5"/><circle cx="32" cy="20" r="6" fill="#fff"/><circle cx="20" cy="40" r="6" fill="#a5b4fc"/><circle cx="44" cy="40" r="6" fill="#fda4af"/></svg>`,
    },
    {
      name: "google-docs",
      title: "Google Docs",
      tagline: "The agent proposes edits and comments on a Google Doc; you approve what goes in.",
      description: "Edit a Google Doc with the agent: it proposes changes, comments and replies, you approve them or type in the doc yourself.",
      kinds: ["app"],
      recommendWhen: "the user wants to edit a Google Doc",
      repo: "https://github.com/sodre90/mirador-google-docs.git",
      release: "1.1.4",
      commit: "1288aea9b219b646c2e155ecee8ea4f5a211b11b",
      api: 4,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2f6bff"/><g fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 12h18l10 10v30H18z"/><path d="M36 12v10h10M24 32h14M24 40h9"/></g></svg>`,
    },
    {
      name: "github",
      title: "GitHub",
      tagline: "A workspace's GitHub issues and pull requests in a tab; hand one to the agent.",
      description: "The issues and pull requests of a workspace's GitHub repository in a tab beside the chat.",
      kinds: ["canvas"],
      recommendWhen: "the user works on GitHub issues or pull requests",
      repo: "https://github.com/sodre90/mirador-github.git",
      release: "0.2.4",
      commit: "732226d4243d675ebe8a138d6455abeb5f23bc36",
      api: 7,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#24292f"/><g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="13" r="3.6"/><circle cx="15" cy="35" r="3.6"/><path d="M15 16.6v14.8"/><path d="M33 31.4V20a4.5 4.5 0 0 0-4.5-4.5H23"/><path d="m26 11.5-3.5 4 3.5 4"/></g><circle cx="33" cy="35" r="3.6" fill="#3fb950"/></svg>`,
    },
    {
      name: "jira",
      title: "Jira",
      tagline: "Your Jira issues and sprint board in a tab; hand an issue to the agent.",
      description: "A workspace's Jira project in a tab beside the chat: sprint board, status changes, and hand an issue to the agent.",
      kinds: ["canvas"],
      recommendWhen: "the workspace tracks issues in Jira",
      repo: "https://github.com/sodre90/mirador-jira.git",
      release: "0.4.0",
      commit: "86f91f31dcf050d17c691b4f7327a106f282c066",
      api: 7,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="12" fill="#0b5cd5"/><g fill="#fff"><rect x="8" y="10" width="9" height="11" rx="2.5"/><rect x="8" y="24" width="9" height="11" rx="2.5" opacity=".75"/><rect x="19.5" y="10" width="9" height="11" rx="2.5"/></g><rect x="31" y="10" width="9" height="11" rx="2.5" fill="#36d399"/></svg>`,
    },
    {
      name: "routines",
      title: "Routines",
      tagline: "Run a prompt in a workspace on a schedule, each run a conversation of its own.",
      description: "Schedule recurring prompts per workspace so agents keep tabs on builds, issues and summaries automatically.",
      kinds: ["canvas"],
      recommendWhen: "the user wants to schedule a recurring prompt",
      repo: "https://github.com/sodre90/mirador-routines.git",
      release: "0.4.0",
      commit: "3333333333333333333333333333333333333333",
      api: 23,
      icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0891b2"/><circle cx="32" cy="32" r="17" fill="none" stroke="#fff" stroke-width="4.5"/><path d="M32 22v11l7 4" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
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

/** Links default plugins, Delegate and Media (all built) into the host's plugins folder, and writes the catalog. */
export function setUpPlugins(dataDir: string, catalogFile: string) {
  const plugins = join(dataDir, "plugins");
  mkdirSync(plugins, { recursive: true });
  for (const release of [...comesWithMirador(), DELEGATE, MEDIA]) symlinkSync(cloned(release, true), join(plugins, release.name));
  writeFileSync(catalogFile, JSON.stringify(catalog));
}
