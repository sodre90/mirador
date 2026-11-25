import type { MountedFolder } from "./added-folders.ts";

/** What a session in a sandbox is told of it hangs on: the folders of this computer its VM mounted beside its workspace. */
export interface SessionInSandbox {
  folders: MountedFolder[];
}

/** True whatever the sandbox reaches at the moment, as that may change in the middle of a session. */
const NETWORK_GUIDANCE = `# Network
You work in a sandbox that has no network of its own. What its owner lets it reach goes through the web proxy named in HTTP_PROXY and HTTPS_PROXY, which git over HTTPS, npm and Bun use by themselves, and Node's fetch with NODE_USE_ENV_PROXY=1; what uses no web proxy, such as SSH, reaches nothing. The owner lets it reach no more than your model and Mirador's canvas, or the internet, or everything their computer reaches, and may change that at any time. The proxy answers 403 Forbidden to what it doesn't let through: tell the owner what you need rather than look for another way.`;

const FILES_GUIDANCE = `# Files you can't change
In the folder you work in, your sandbox refuses some writes, which fail as on a read-only file system: to git's config and hooks, to the files that config includes, and to the agent config files that were there as it started (such as CLAUDE.md, AGENTS.md, .mcp.json or anything in .claude). An agent config file you add there is put back and waits for the owner's OK. It refuses to make a repository there too, as git init, git clone, git worktree add or a new submodule would, and so any file or link called HEAD outside git's own folders: make it in /tmp. A folder with a file called HEAD counts as a bare repository there: no link can be made in it, and nothing moved in or out other than by copying. Git can't set a remote or an upstream there, and git branch -m renames the branch though it then exits with an error, as it can't update its config. Tell the owner what you need changed rather than look for another way.`;

const SHARED_FILES_GUIDANCE = `# Files the owner works on too
The owner may change the files of the folder you work in from their computer as you work. A file watcher in your sandbox isn't told of their changes: have it poll instead, as with CHOKIDAR_USEPOLLING=1. A file lock taken in your sandbox isn't seen on their computer, nor theirs in it: don't open a database file, such as one of SQLite's, that a program there has open.`;

const foldersGuidance = (folders: MountedFolder[]) => `# Folders from the owner's computer
Besides the folder you work in, your sandbox has these folders of the owner's computer, at the same paths. Read the read-only ones for reference: nothing you do can change them. Change the read-and-write ones as you would the folder you work in: the same writes are refused there.
${folders.map(({ path, writable }) => `- ${path} (${writable ? "read and write" : "read-only"})`).join("\n")}`;

/** What a sandboxed agent is told of its sandbox, in parts; nothing where it works on this computer. */
export const sandboxGuidance = (sandbox: SessionInSandbox | null): string[] => (sandbox ? [NETWORK_GUIDANCE, FILES_GUIDANCE, SHARED_FILES_GUIDANCE, ...(sandbox.folders.length > 0 ? [foldersGuidance(sandbox.folders)] : [])] : []);
