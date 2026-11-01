import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { MAX_IMAGE_BYTES } from "./images.ts";

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) => signature.every((byte, index) => bytes[offset + index] === byte);

const signatures: [mimeType: string, matches: (header: Uint8Array) => boolean][] = [
  ["image/png", (header) => startsWith(header, [0x89, ...ascii("PNG\r\n"), 0x1a, 0x0a])],
  ["image/jpeg", (header) => startsWith(header, [0xff, 0xd8, 0xff])],
  ["image/gif", (header) => startsWith(header, ascii("GIF87a")) || startsWith(header, ascii("GIF89a"))],
  ["image/webp", (header) => startsWith(header, ascii("RIFF")) && startsWith(header, ascii("WEBP"), 8)],
];

export const imageTypeOf = (header: Uint8Array) => signatures.find(([, matches]) => matches(header))?.[0] ?? null;

const isFileUpTo = async (path: string, maxBytes: number) => {
  const found = await stat(path).catch(() => null);
  return found !== null && found.isFile() && found.size <= maxBytes;
};

/** A file an agent named in its reply, served only when its own bytes say it is an image, whatever its name says. */
export async function localImage(path: string): Promise<{ file: Bun.BunFile; mimeType: string } | null> {
  if (!isAbsolute(path) || !(await isFileUpTo(path, MAX_IMAGE_BYTES))) return null;
  const file = Bun.file(path);
  const mimeType = imageTypeOf(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  return mimeType ? { file, mimeType } : null;
}
