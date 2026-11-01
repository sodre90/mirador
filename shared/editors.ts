/** The editors Mirador knows how to open a file at a line in, in the order it picks the first one found. */
export const knownEditorIds = ["idea", "code", "cursor", "zed", "subl"] as const;

export type KnownEditorId = (typeof knownEditorIds)[number];

export const knownEditorNames: Record<KnownEditorId, string> = {
  idea: "IDEA",
  code: "VS Code",
  cursor: "Cursor",
  zed: "Zed",
  subl: "Sublime Text",
};

/** What Settings say Open in … uses: the first editor found, one Mirador knows, or a command line of the owner's. */
export type EditorSetting = { editor: "first-found" } | { editor: KnownEditorId } | { editor: "custom"; command: string };

export interface EditorState {
  setting: EditorSetting;
  /** The known editors whose launchers this host finds, in knownEditorIds' order. */
  found: KnownEditorId[];
  /** The name Open in … buttons show; null when the first editor found is wanted and none is. */
  opensIn: string | null;
}

export const isKnownEditorId = (value: unknown): value is KnownEditorId => knownEditorIds.includes(value as KnownEditorId);

export function isEditorSetting(value: unknown): value is EditorSetting {
  if (typeof value !== "object" || value === null) return false;
  const { editor, command } = value as { editor?: unknown; command?: unknown };
  return editor === "first-found" || isKnownEditorId(editor) || (editor === "custom" && typeof command === "string");
}
