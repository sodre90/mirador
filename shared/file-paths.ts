/** A path to a file as an agent writes it inline: absolute, or relative with a folder, and an extension. Windows writes its separators as backslashes. */
export const looksLikeFilePath = (text: string) => /^(?:[a-zA-Z]:[\\/]|[\/\\]|[\w.-]+[\\/])\S*\.\w+$/.test(text);
