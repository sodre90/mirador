/**
 * Viewport units in a page's style blocks and style attributes read the frame's own --mirador-vw and --mirador-vh: a
 * page zoomed to the text size gets them multiplied by the zoom, and one as tall as a frame sized to its content would
 * chase the frame. Only declaration values change: a var() in a selector or an @media or @supports prelude would break the rule.
 */
export function viewportUnitsFromFrame(html: string) {
  return html.replace(STYLE_BLOCK, (_, open: string, css: string, close: string) => open + declarationsFromFrame(css) + close).replace(TAG, tagFromFrame);
}

const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi;
const TAG = /<[a-z][^<>]*>/gi;
const STYLE_ATTRIBUTE = /(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const DECLARATION = /((?:^|[{};])\s*[-\w]+\s*:)([^;{}]*)/g;
const QUOTED_OR_URL_OR_VIEWPORT_LENGTH = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\))|(?<![\w.-])(-?(?:\d+\.?\d*|\.\d+))[dsl]?v(h|w|min|max)\b/gi;

const FRAME_VIEWPORT_UNITS: Record<string, string> = {
  h: "var(--mirador-vh, 1vh)",
  w: "var(--mirador-vw, 1vw)",
  min: "min(var(--mirador-vw, 1vw), var(--mirador-vh, 1vh))",
  max: "max(var(--mirador-vw, 1vw), var(--mirador-vh, 1vh))",
};

function tagFromFrame(tag: string) {
  return tag.replace(STYLE_ATTRIBUTE, (_, name: string, doubleQuoted: string | undefined, singleQuoted: string | undefined) =>
    doubleQuoted !== undefined ? `${name}"${declarationsFromFrame(doubleQuoted)}"` : `${name}'${declarationsFromFrame(singleQuoted!)}'`,
  );
}

function declarationsFromFrame(css: string) {
  return css.replace(DECLARATION, (declaration: string, property: string, value: string, offset: number) => {
    const startsANestedRule = css[offset + declaration.length] === "{";
    return startsANestedRule ? declaration : property + valueFromFrame(value);
  });
}

function valueFromFrame(value: string) {
  return value.replace(QUOTED_OR_URL_OR_VIEWPORT_LENGTH, (match: string, quotedOrUrl: string | undefined, amount: string | undefined, unit: string | undefined) =>
    quotedOrUrl ?? `calc(${amount} * ${FRAME_VIEWPORT_UNITS[unit!.toLowerCase()]})`,
  );
}
