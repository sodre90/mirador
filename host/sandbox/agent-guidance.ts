import type { MountedFolder } from "./added-folders.ts";

/** What a session in a sandbox is told of it hangs on: the folders of this computer its VM mounted beside its workspace. */
export interface SessionInSandbox {
  folders: MountedFolder[];
}

/** True whatever the sandbox reaches at the moment, as that may change in the middle of a session. */
const NETWORK_GUIDANCE = `# Network
You work in a sandbox that has no network of its own. What its owner lets it reach goes through the web proxy named in HTTP_PROXY and HTTPS_PROXY, which git over HTTPS, npm and Bun use by themselves, and Node's fetch with NODE_USE_ENV_PROXY=1; what uses no web proxy, such as SSH, reaches nothing. The owner lets it reach no more than your model and Mirador's canvas, or the internet, or everything their computer reaches, and may change that at any time. The proxy answers 403 Forbidden to what it doesn't let through: tell the owner what you need rather than look for another way.`;

const foldersGuidance = (folders: MountedFolder[]) => `# Folders from the owner's computer
Besides the folder you work in, your sandbox has these folders of the owner's computer, at the same paths. Read the read-only ones for reference: nothing you do can change them. Change the read-and-write ones as you would the folder you work in: their git config and hooks stay read-only, and an agent config file you add or change there (such as CLAUDE.md, AGENTS.md, .mcp.json or anything in .claude) is put back and waits for the owner's OK.
${folders.map(({ path, writable }) => `- ${path} (${writable ? "read and write" : "read-only"})`).join("\n")}`;

/** What a sandboxed agent is told of its sandbox, in parts; nothing where it works on this computer. */
export const sandboxGuidance = (sandbox: SessionInSandbox | null): string[] => (sandbox ? [NETWORK_GUIDANCE, ...(sandbox.folders.length > 0 ? [foldersGuidance(sandbox.folders)] : [])] : []);
