/**
 * Viewport units in a page's style blocks and style attributes read the frame's own --mirador-vw and --mirador-vh: a
 * page zoomed to the text size would otherwise get them multiplied by the zoom, and one in a frame sized to its content
 * would chase the frame as it grows. Only declaration values change: a var() in a selector or an @media or @supports
 * prelude would break the rule. Self-contained, as a canvas frame embeds this function to rewrite the viewport lengths a
 * page writes after it loads.
 */
export function viewportUnitsInDeclarations(css: string) {
  const frameUnits: Record<string, string> = {
    h: "var(--mirador-vh)",
    w: "var(--mirador-vw)",
    min: "min(var(--mirador-vw), var(--mirador-vh))",
    max: "max(var(--mirador-vw), var(--mirador-vh))",
  };
  const declaration = /((?:^|[{};])\s*[-\w]+\s*:)([^;{}]*)/g;
  const quotedOrUrlOrViewportLength = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|url\([^)]*\))|(?<![\w.-])(-?(?:\d+\.?\d*|\.\d+))[dsl]?v(h|w|min|max)\b/gi;
  return css.replace(declaration, (whole: string, property: string, value: string, offset: number) => {
    const startsANestedRule = css[offset + whole.length] === "{";
    if (startsANestedRule) return whole;
    return property + value.replace(quotedOrUrlOrViewportLength, (match: string, quotedOrUrl: string | undefined, amount: string | undefined, unit: string | undefined) =>
      quotedOrUrl ?? `calc(${amount} * ${frameUnits[unit!.toLowerCase()]})`,
    );
  });
}

export function viewportUnitsFromFrame(html: string) {
  return html.replace(STYLE_BLOCK, (_, open: string, css: string, close: string) => open + viewportUnitsInDeclarations(css) + close).replace(TAG, tagFromFrame);
}

const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi;
const TAG = /<[a-z][^<>]*>/gi;
const STYLE_ATTRIBUTE = /(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;

function tagFromFrame(tag: string) {
  return tag.replace(STYLE_ATTRIBUTE, (_, name: string, doubleQuoted: string | undefined, singleQuoted: string | undefined) =>
    doubleQuoted !== undefined ? `${name}"${viewportUnitsInDeclarations(doubleQuoted)}"` : `${name}'${viewportUnitsInDeclarations(singleQuoted!)}'`,
  );
}
