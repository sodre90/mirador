import { AVATAR_PIXELS } from "../shared/avatar.ts";
import { t } from "./i18n/index.ts";

const words = t.profiles.picture;

/** The largest picture file Settings reads; anything bigger is not a picture anyone would wear as an avatar. */
export const MAX_PICTURE_FILE_BYTES = 10 * 1024 * 1024;

/**
 * The chosen file as the square PNG data URL the host stores: cut to its middle square and drawn at 128 pixels,
 * so the store and the WebSocket carry only a small picture however big the file was.
 */
export async function profilePictureDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error(words.notAnImage);
  if (file.size > MAX_PICTURE_FILE_BYTES) throw new Error(words.tooBig);
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(words.unreadable);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_PIXELS;
  canvas.height = AVATAR_PIXELS;
  const edge = Math.min(bitmap.width, bitmap.height);
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge, 0, 0, AVATAR_PIXELS, AVATAR_PIXELS);
  bitmap.close();
  return canvas.toDataURL("image/png");
}
