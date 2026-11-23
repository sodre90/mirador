/** What a sandboxed agent is told of the folders of the owner's computer its VM mounted beside its workspace; nothing where none is. */
export const sandboxFoldersGuidance = (folders: string[]) =>
  folders.length === 0
    ? ""
    : `# Folders from the owner's computer
Besides the folder you work in, your sandbox has these folders of the owner's computer, at the same paths. They are read-only: read them for reference, but nothing you do can change them.
${folders.map((folder) => `- ${folder}`).join("\n")}`;
