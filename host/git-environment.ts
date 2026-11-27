import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Nobody is there to type a password or a key's passphrase, and a prompt would land in the terminal the host was started from. */
export const environmentWithoutPrompts = () => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? "ssh -o BatchMode=yes",
});

/**
 * A repository's fsmonitor setting names a program git runs on a plain status, in its submodules too, as `-c` reaches
 * them; a sandboxed room's agent may have written one. Mirador's own git never runs it.
 */
export const GIT_WITHOUT_FSMONITOR = ["-c", "core.fsmonitor=false"];

/** What Mirador's own git runs with when it only looks or works in the background: neither fsmonitor nor any hook. */
export const GIT_WITHOUT_REPOSITORY_PROGRAMS = [...GIT_WITHOUT_FSMONITOR, "-c", "core.hooksPath=/dev/null"];

/** What a commit, land, pull or worktree the owner asked for runs with: their hooks, as their own git would. */
export const GIT_WITH_OWNERS_HOOKS = GIT_WITHOUT_FSMONITOR;

/**
 * Git takes its config from the folder a repository's `.git/commondir` names, which a sandboxed room's VM can write;
 * naming the repository's own `.git` folder as its common folder keeps git from reading that file. A `.git` file, a
 * linked worktree's or a submodule's, is left to git, and a `.git` folder without a HEAD is passed over, as git does.
 */
export function ownCommonFolderOf(directory: string): { GIT_COMMON_DIR?: string } {
  for (let folder = resolve(directory); ; folder = dirname(folder)) {
    const gitEntry = statSync(join(folder, ".git"), { throwIfNoEntry: false });
    if (gitEntry?.isFile()) return {};
    if (gitEntry?.isDirectory() && statSync(join(folder, ".git", "HEAD"), { throwIfNoEntry: false })) return { GIT_COMMON_DIR: join(folder, ".git") };
    if (dirname(folder) === folder) return {};
  }
}

/**
 * The repository as its commits were made: its own common folder, and objects as written, never what a replace ref,
 * which a sandboxed room's agent may add, shows in their place, so a diff can't show harmless content for harmful.
 */
export const repositoryAsCommitted = (directory: string) => ({ ...ownCommonFolderOf(directory), GIT_NO_REPLACE_OBJECTS: "1" });

/** The environment Mirador's own git runs with in `directory`: no prompts, and the repository as committed. */
export const gitEnvironmentFor = (directory: string) => ({ ...environmentWithoutPrompts(), ...repositoryAsCommitted(directory) });
