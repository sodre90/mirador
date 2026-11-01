/** Claude Code records an API error as an answer from a made-up model such as "<synthetic>". */
export const isRealModel = (model: unknown): model is string => typeof model === "string" && model.trim() !== "" && !/^<[^>]+>$/.test(model.trim());

const CLAUDE_MODEL_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;

/** "claude-haiku-5-5" reads "Haiku 5.5"; a name in any other form stays as it is. */
export function modelLabel(model: string) {
  const match = CLAUDE_MODEL_ID.exec(model);
  if (!match) return model;
  const [, family, major, minor] = match;
  return `${family!.charAt(0).toUpperCase()}${family!.slice(1)} ${minor ? `${major}.${minor}` : major}`;
}
