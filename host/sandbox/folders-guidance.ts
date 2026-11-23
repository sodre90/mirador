import type { MountedFolder } from "./added-folders.ts";

/** What a sandboxed agent is told of the folders of the owner's computer its VM mounted beside its workspace; nothing where none is. */
export const sandboxFoldersGuidance = (folders: MountedFolder[]) =>
  folders.length === 0
    ? ""
    : `# Folders from the owner's computer
Besides the folder you work in, your sandbox has these folders of the owner's computer, at the same paths. Read the read-only ones for reference: nothing you do can change them. Change the read-and-write ones as you would the folder you work in: their git config and hooks stay read-only, and an agent config file you add or change there (such as CLAUDE.md, AGENTS.md, .mcp.json or anything in .claude) is put back and waits for the owner's OK.
${folders.map(({ path, writable }) => `- ${path} (${writable ? "read and write" : "read-only"})`).join("\n")}`;
