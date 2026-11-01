/** The edge, in pixels, of the square a profile picture is drawn at before it is sent to the host. */
export const AVATAR_PIXELS = 128;
/** The most the stored picture may weigh, so the database and the WebSocket stay light; a 128 px PNG sits well under it. */
export const MAX_AVATAR_BYTES = 64 * 1024;
/** The widest square the host takes. The pages draw at AVATAR_PIXELS; this leaves room for a client that draws bigger. */
export const MAX_AVATAR_EDGE = 256;

const DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR_AT = 12;
const SIZE_AT = 16;

/**
 * Why this string is not a picture the host can store as the profile picture, or null when it is:
 * a PNG data URL, a square no wider than MAX_AVATAR_EDGE and no heavier than MAX_AVATAR_BYTES.
 */
export function avatarProblem(image: string): string | null {
  if (!image.startsWith(DATA_URL_PREFIX)) return "A profile picture has to be a PNG image.";
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(image.slice(DATA_URL_PREFIX.length)), (character) => character.charCodeAt(0));
  } catch {
    return "That profile picture is damaged.";
  }
  if (bytes.length > MAX_AVATAR_BYTES) return `A profile picture may weigh at most ${MAX_AVATAR_BYTES >> 10} KB.`;
  if (!isPng(bytes)) return "That profile picture is not a PNG file.";
  const width = readUInt32BE(bytes, SIZE_AT);
  const height = readUInt32BE(bytes, SIZE_AT + 4);
  if (width !== height) return "A profile picture has to be a square.";
  if (width < 1 || width > MAX_AVATAR_EDGE) return `A profile picture has to be at most ${MAX_AVATAR_EDGE} pixels wide.`;
  return null;
}

function isPng(bytes: Uint8Array) {
  if (bytes.length < SIZE_AT + 8) return false;
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte) && String.fromCharCode(...bytes.slice(IHDR_AT, IHDR_AT + 4)) === "IHDR";
}

function readUInt32BE(bytes: Uint8Array, at: number) {
  return ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;
}
