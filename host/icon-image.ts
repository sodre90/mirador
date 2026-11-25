export const MAX_ICON_BYTES = 256 * 1024;
const MAX_DRAWING_BYTES_BESIDES_OUTLINES = 64 * 1024;
const MAX_PIXELS_ACROSS = 2048;
const MAX_REFERENCES = 12;

export const TOO_LARGE = "it is over 256 KB";
const TOO_WIDE = `it has no image, or one over ${MAX_PIXELS_ACROSS} pixels across`;

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

const plainElements = ["svg", "g", "defs", "title", "desc", "metadata", "style", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "linearGradient", "radialGradient", "stop"];
const elementsDrawingOthers = ["use", "symbol", "mask", "clipPath"];
const editorsNotes = ["namedview", "guide", "grid", "RDF", "Work", "format", "type"];

const elementNamed = (names: string[]) => `(?:[\\w-]+:)?(?:${names.join("|")})(?=[\\s/>])`;
const quotedValue = `(?:"[^"<]*"|'[^'<]*')`;
const FORBIDDEN_MARKUP = new RegExp(`<(?!/?${elementNamed([...plainElements, ...elementsDrawingOthers, ...editorsNotes])})[/!?]?[\\w:-]{0,40}`);
const DRAWS_OTHERS = new RegExp(`<${elementNamed(elementsDrawingOthers)}`);
const STYLE_SHEET = new RegExp(`<${elementNamed(["style"])}`);
/** A browser joins the text before and after an element inside a style sheet, which could be two halves of a forbidden word. */
const ELEMENT_IN_STYLE_SHEET = new RegExp(`<${elementNamed(["style"])}(?![^<>"'=]*/>)[^<]*<(?!/)`);
const ROOT = new RegExp(`<${elementNamed(["svg"])}`);
const XML_DECLARATION = /^\s*<\?xml\s[^<>]*\?>/;
const CONTROL_CHARACTERS = /[\0-\x08\x0b\x0c\x0e-\x1f]/;
/**
 * Costly to draw, or holding a document of its own; a backslash or a character reference could spell either another way.
 * A filter acts as an attribute, as a property, which a comment may part from its colon, or as a function making an image.
 */
const COSTLY_OR_DISGUISED = /filter\s*[=:/(]|data:|@import|\\|&#/i;
const REFERENCE = /url\(|href/gi;

/** A comment or a CDATA section inside a word of a style sheet, or an entity an XHTML doctype names, would spell what is forbidden another way. */
const COMMENT_CDATA_OR_DOCTYPE = /<!--[^]*?(?:-->|$)|<!\[CDATA\[([^<&]*?)\]\]>|<!DOCTYPE\s[^[<>]*>/g;
const onlyElementsAndText = (svg: string) => svg.replace(XML_DECLARATION, "").replace(COMMENT_CDATA_OR_DOCTYPE, "$1");

const filterNamed = elementNamed(["filter"]);
const filters = [
  new RegExp(`<${filterNamed}(?:[^<>]*/>|[^]*?(?:</${filterNamed}[^<>]*>|$))`, "g"),
  new RegExp(`\\sfilter\\s*=\\s*${quotedValue}`, "gi"),
  /(?<![\w-])(?:-webkit-)?(?:backdrop-)?filter\s*:(?:[^;{}"'<>&(]+|&\w+;|\("[^"<>]*"\)|\('[^'<>]*'\)|[&(])*;?/gi,
];
/** Filters are costly to draw, and an icon looks much the same without its shadow. */
const withoutFilters = (svg: string) => filters.reduce((drawing, filter) => drawing.replace(filter, ""), svg);

const OUTLINE = new RegExp(`(<${elementNamed(["path", "polygon", "polyline"])}(?:\\s+[\\w:.-]+\\s*=\\s*${quotedValue})*?\\s+(?:d|points)\\s*=\\s*)${quotedValue}`, "g");
/** Outlines traced from a picture are long but quick to draw, unlike as many bytes of elements or style sheets. */
const isLongBesidesOutlines = (svg: string) => Buffer.byteLength(svg.replace(OUTLINE, "$1")) > MAX_DRAWING_BYTES_BESIDES_OUTLINES;

/**
 * A style sheet can repeat one reference over many elements, and references to what holds references multiply, so a
 * drawing with any may hold only a few of them and no style sheet. A 1 KB one without this limit froze the page.
 */
const multipliesItsParts = (svg: string) => DRAWS_OTHERS.test(svg) && (STYLE_SHEET.test(svg) || (svg.match(REFERENCE)?.length ?? 0) > MAX_REFERENCES);

const svgRefusals: { reason: (svg: string) => string; applies: (svg: string) => boolean }[] = [
  { applies: (svg) => !ROOT.test(svg), reason: () => "it is no PNG, ICO or SVG" },
  { applies: (svg) => CONTROL_CHARACTERS.test(svg), reason: () => "it holds control characters" },
  { applies: (svg) => FORBIDDEN_MARKUP.test(svg), reason: (svg) => `it holds ${JSON.stringify(svg.match(FORBIDDEN_MARKUP)?.[0])}, which is no plain shape` },
  { applies: (svg) => ELEMENT_IN_STYLE_SHEET.test(svg), reason: () => "it holds an element inside a style sheet" },
  { applies: (svg) => COSTLY_OR_DISGUISED.test(svg), reason: (svg) => `it holds ${JSON.stringify(svg.match(COSTLY_OR_DISGUISED)?.[0])}` },
  { applies: multipliesItsParts, reason: () => `it draws parts again and has a style sheet or over ${MAX_REFERENCES} references` },
  { applies: isLongBesidesOutlines, reason: () => "it is over 64 KB besides the outlines of its shapes" },
];

/** An image as a data URL, or why it isn't shown. */
export type CheckedIcon = { dataUrl: string; refusal: null } | { dataUrl: null; refusal: string };
const shown = (mimeType: string, bytes: Uint8Array): CheckedIcon => ({ dataUrl: `data:${mimeType};base64,${bytes.toBase64()}`, refusal: null });
export const refused = (refusal: string): CheckedIcon => ({ dataUrl: null, refusal });

/**
 * The SVG without its filters and the encoding it declares. Browsers run no script and load nothing for an SVG shown as
 * an image, but draw it on the page's own thread, however long that takes.
 */
function checkedDrawing(bytes: Uint8Array): CheckedIcon {
  const svg = withoutFilters(onlyElementsAndText(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  const refusal = svgRefusals.find(({ applies }) => applies(svg));
  return refusal ? refused(refusal.reason(svg)) : shown("image/svg+xml;charset=utf-8", new TextEncoder().encode(svg));
}

function checkedBytes(bytes: Uint8Array): CheckedIcon {
  if (bytes.length > MAX_ICON_BYTES) return refused(TOO_LARGE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (startsWith(view, PNG_SIGNATURE)) return isSmallPng(view) ? shown("image/png", bytes) : refused(TOO_WIDE);
  if (startsWith(view, ICO_SIGNATURE)) return isSmallIco(view) ? shown("image/x-icon", bytes) : refused(TOO_WIDE);
  return checkedDrawing(bytes);
}

/** The image when its own bytes, whatever its name, say it is a small PNG, ICO or plain SVG, and not cut short or in no readable text. */
export function checkedIcon(bytes: Uint8Array): CheckedIcon {
  try {
    return checkedBytes(bytes);
  } catch {
    return refused("it is cut short or no readable text");
  }
}
