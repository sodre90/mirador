/**
 * A page zoomed to the text size gets viewport units multiplied by the zoom, so 100vh is taller than its frame. In the
 * page's style blocks and style attributes, viewport lengths are divided by the zoom the frame sets as --mirador-zoom.
 * Only declaration values change: a var() in a selector or an @media or @supports prelude would break the rule.
 */
export function viewportUnitsUnzoomed(html: string) {
  return html.replace(STYLE_BLOCK, (_, open: string, css: string, close: string) => open + declarationsUnzoomed(css) + close).replace(TAG, tagUnzoomed);
}

const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi;
const TAG = /<[a-z][^<>]*>/gi;
const STYLE_ATTRIBUTE = /(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const DECLARATION = /((?:^|[{};])\s*[-\w]+\s*:)([^;{}]*)/g;
const QUOTED_OR_URL_OR_VIEWPORT_LENGTH = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\))|(?<![\w.-])(-?(?:\d+\.?\d*|\.\d+)[dsl]?v(?:h|w|min|max))\b/gi;

function tagUnzoomed(tag: string) {
  return tag.replace(STYLE_ATTRIBUTE, (_, name: string, doubleQuoted: string | undefined, singleQuoted: string | undefined) =>
    doubleQuoted !== undefined ? `${name}"${declarationsUnzoomed(doubleQuoted)}"` : `${name}'${declarationsUnzoomed(singleQuoted!)}'`,
  );
}

function declarationsUnzoomed(css: string) {
  return css.replace(DECLARATION, (declaration: string, property: string, value: string, offset: number) => {
    const startsANestedRule = css[offset + declaration.length] === "{";
    return startsANestedRule ? declaration : property + valueUnzoomed(value);
  });
}

function valueUnzoomed(value: string) {
  return value.replace(QUOTED_OR_URL_OR_VIEWPORT_LENGTH, (match: string, quotedOrUrl: string | undefined, length: string | undefined) =>
    quotedOrUrl ?? `calc(${length} / var(--mirador-zoom, 1))`,
  );
}
