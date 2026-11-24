const MAX_RASTER_BYTES = 256 * 1024;
const MAX_DRAWING_BYTES = 64 * 1024;
const MAX_PIXELS_ACROSS = 2048;
const MAX_REFERENCES = 12;

export const MAX_ICON_BYTES = Math.max(MAX_RASTER_BYTES, MAX_DRAWING_BYTES);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ICO_SIGNATURE = [0, 0, 1, 0];
const IHDR = 0x49484452;

const startsWith = (view: DataView, signature: number[]) => view.byteLength >= signature.length && signature.every((byte, index) => view.getUint8(index) === byte);
const isSmall = (...sizes: number[]) => sizes.every((size) => size > 0 && size <= MAX_PIXELS_ACROSS);

const isSmallPng = (png: DataView) => png.getUint32(12) === IHDR && isSmall(png.getUint32(16), png.getUint32(20));

/** A bitmap in an ICO says twice its height, as its mask follows its colours. */
const isSmallBitmap = (bitmap: DataView) => isSmall(bitmap.getInt32(4, true), Math.abs(bitmap.getInt32(8, true)) / 2);

function isSmallIco(ico: DataView) {
  const imageOffsets = Array.from({ length: ico.getUint16(4, true) }, (_, index) => ico.getUint32(6 + 16 * index + 12, true));
  const images = imageOffsets.map((offset) => new DataView(ico.buffer, ico.byteOffset + offset, ico.byteLength - offset));
  return images.length > 0 && images.every((image) => (startsWith(image, PNG_SIGNATURE) ? isSmallPng(image) : isSmallBitmap(image)));
}

function rasterType(view: DataView) {
  if (startsWith(view, PNG_SIGNATURE)) return isSmallPng(view) ? "image/png" : null;
  if (startsWith(view, ICO_SIGNATURE)) return isSmallIco(view) ? "image/x-icon" : null;
  return null;
}

const plainElements = ["svg", "g", "defs", "title", "desc", "metadata", "style", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "linearGradient", "radialGradient", "stop"];
const elementsDrawingOthers = ["use", "symbol", "mask", "clipPath"];
const editorsNotes = ["namedview", "guide", "grid", "RDF", "Work", "format", "type"];

const elementNamed = (names: string[]) => `(?:[\\w-]+:)?(?:${names.join("|")})(?=[\\s/>])`;
const allowedMarkup = [`/?${elementNamed([...plainElements, ...elementsDrawingOthers, ...editorsNotes])}`, "!--", "!\\[CDATA\\[", "!DOCTYPE\\s[^[<>]*>"];
const FORBIDDEN_MARKUP = new RegExp(`<(?!${allowedMarkup.join("|")})`);
const DRAWS_OTHERS = new RegExp(`<${elementNamed(elementsDrawingOthers)}`);
const STYLE_SHEET = new RegExp(`<${elementNamed(["style"])}`);
const ROOT = new RegExp(`<${elementNamed(["svg"])}`);
const XML_DECLARATION = /^\s*<\?xml\s[^<>]*\?>/;
const CONTROL_CHARACTERS = /[\0-\x08\x0b\x0c\x0e-\x1f]/;
/** Costly to draw, or holding a document of its own; a backslash or a character reference could spell either another way. */
const COSTLY_OR_DISGUISED = /filter|data:|@import|\\|&#/i;
const REFERENCE = /url\(|href/gi;

/**
 * A style sheet can repeat one reference over many elements, and references to what holds references multiply, so a
 * drawing with any may hold only a few of them and no style sheet. A 1 KB one without this limit froze the page.
 */
const multipliesItsParts = (svg: string) => DRAWS_OTHERS.test(svg) && (STYLE_SHEET.test(svg) || (svg.match(REFERENCE)?.length ?? 0) > MAX_REFERENCES);

/**
 * The SVG when a browser is sure to draw it quickly, without the encoding it declares. Browsers run no script and load
 * nothing for an SVG shown as an image, but draw it on the page's own thread, however long that takes.
 */
function plainDrawing(bytes: Uint8Array): string | null {
  const svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(XML_DECLARATION, "");
  const refused = !ROOT.test(svg) || [FORBIDDEN_MARKUP, CONTROL_CHARACTERS, COSTLY_OR_DISGUISED].some((pattern) => pattern.test(svg)) || multipliesItsParts(svg);
  return refused ? null : svg;
}

const base64Url = (mimeType: string, bytes: Uint8Array) => `data:${mimeType};base64,${bytes.toBase64()}`;

function checkedDataUrl(bytes: Uint8Array): string | null {
  const type = bytes.length <= MAX_RASTER_BYTES ? rasterType(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)) : null;
  if (type) return base64Url(type, bytes);
  const svg = bytes.length <= MAX_DRAWING_BYTES ? plainDrawing(bytes) : null;
  return svg === null ? null : base64Url("image/svg+xml;charset=utf-8", new TextEncoder().encode(svg));
}

/** The image as a data URL when its own bytes, whatever its name, say it is a small PNG, ICO or plain SVG; null for one cut short or in no readable text. */
export function iconDataUrl(bytes: Uint8Array): string | null {
  try {
    return checkedDataUrl(bytes);
  } catch {
    return null;
  }
}
