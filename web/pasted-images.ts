import { connection } from "./connection.ts";
import { refusalText } from "./host-error.ts";

/** An image pasted into the message box, which the text mentions as `[Image #number]`, as Claude Code does. */
export interface Attachment {
  number: number;
  imageId: string;
}

const placeholderPattern = /\[Image #(\d+)\]/g;

export const placeholder = (number: number) => `[Image #${number}]`;

export const nextNumber = (taken: number[]) => Math.max(0, ...taken) + 1;

/** The attachments the text still mentions, in the order it first mentions them: deleting a placeholder drops its image. */
export function referencedAttachments(text: string, attachments: Attachment[]): Attachment[] {
  return attachments
    .map((attachment) => ({ attachment, at: text.indexOf(placeholder(attachment.number)) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at)
    .map(({ attachment }) => attachment);
}

export const withoutPlaceholder = (text: string, number: number) => text.replaceAll(`${placeholder(number)} `, "").replaceAll(placeholder(number), "");

/**
 * A queued message back in the message box: its images were sent in the order the text first mentions them, and
 * they get numbers after the ones already in the box.
 */
export function restoredDraft(text: string, imageIds: string[], inTheBox: Attachment[]): { text: string; attachments: Attachment[] } {
  const mentioned = [...new Set([...text.matchAll(placeholderPattern)].map((match) => match[1]!))].slice(0, imageIds.length);
  const first = nextNumber(inTheBox.map(({ number }) => number));
  const renumbered = new Map(mentioned.map((number, index) => [number, first + index]));
  return {
    text: text.replace(placeholderPattern, (match, number: string) => {
      const replacement = renumbered.get(number);
      return replacement === undefined ? match : placeholder(replacement);
    }),
    attachments: mentioned.map((number, index) => ({ number: renumbered.get(number)!, imageId: imageIds[index]! })),
  };
}

export const imageFilesIn = (transfer: DataTransfer | null) => [...(transfer?.files ?? [])].filter((file) => file.type.startsWith("image/"));

/**
 * Spreadsheet cells and rich text come with a picture of themselves, so text on the clipboard makes it a text paste,
 * unless the text is only the name of the image file copied in Finder.
 */
export function imagesToPaste(clipboardText: string, images: File[]): File[] {
  const text = clipboardText.trim();
  return text && !images.some(({ name }) => name === text) ? [] : images;
}

const MAX_EDGE = 2000;
const MAX_BYTES = 3.75 * 1024 * 1024;

/**
 * Claude refuses an image over 5 MB once base64-encoded, and scales anything larger than about 1.15 megapixels down
 * anyway, so a big screenshot is shrunk here rather than refused there. GIFs stay as they are, to keep them moving.
 */
async function sendable(image: Blob): Promise<Blob> {
  if (image.type === "image/gif") return image;
  const bitmap = await createImageBitmap(image);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && image.size <= MAX_BYTES) return image;
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const png = await canvas.convertToBlob({ type: "image/png" });
  return png.size <= MAX_BYTES ? png : canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
}

/** Pasted images that no message took: the host deletes those that no sent or queued message carries. */
export function discardImages(conversationId: string, attachments: Attachment[]) {
  if (attachments.length > 0) connection.send({ type: "images.discard", conversationId, imageIds: attachments.map(({ imageId }) => imageId) });
}

/** Stores the image with the conversation in the host, which hands it to the agent with the message that mentions it. */
export async function uploadImage(conversationId: string, image: Blob): Promise<string> {
  const body = await sendable(image);
  const response = await fetch(`/conversations/${conversationId}/images`, { method: "POST", headers: { "Content-Type": body.type }, body });
  if (!response.ok) throw new Error(await refusalText(response, String(response.status)));
  return ((await response.json()) as { imageId: string }).imageId;
}
