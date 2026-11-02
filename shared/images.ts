/** The image types Claude and opencode take, by the file extension the host stores them under. */
export const imageTypes = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
} as const;

export type ImageExtension = keyof typeof imageTypes;

const imageIdPattern = /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;

export const isImageId = (imageId: string) => imageIdPattern.test(imageId);

export const extensionFor = (mimeType: string) =>
  (Object.entries(imageTypes) as [ImageExtension, string][]).find(([, type]) => type === mimeType)?.[0];

export const mimeTypeOf = (imageId: string) => imageTypes[imageId.split(".").at(-1) as ImageExtension];

export const imageUrl = (conversationId: string, imageId: string) => `/conversations/${conversationId}/images/${imageId}`;

/** An image the agent's update carried, shown from its own data: never fetched from an address the agent named. */
export const carriedImageSource = ({ mimeType, data }: { mimeType: string; data: string }) =>
  extensionFor(mimeType) && data ? `data:${mimeType};base64,${data}` : null;

const windowsDrivePath = /^[A-Za-z]:[\\/]/;

/** An absolute path on the host's machine, as an agent names a screenshot it took; not an address on another site. */
export const isLocalImagePath = (source: string) => (source.startsWith("/") && !source.startsWith("//")) || windowsDrivePath.test(source);

/** Markdown percent-encodes an image's address, so a path with spaces or accents arrives encoded. */
const decodedPath = (source: string) => {
  try {
    return decodeURI(source);
  } catch {
    return source;
  }
};

export const localImageUrl = (conversationId: string, source: string) => `/conversations/${conversationId}/local-image?path=${encodeURIComponent(decodedPath(source))}`;
