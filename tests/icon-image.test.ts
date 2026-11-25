import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { checkedIcon } from "../host/icon-image.ts";

const iconDataUrl = (bytes: Uint8Array) => checkedIcon(bytes).dataUrl;
const refusal = (bytes: Uint8Array) => checkedIcon(bytes).refusal;

const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const [length, checksum] = [data.length, crc32(body)].map((value) => {
    const written = Buffer.alloc(4);
    written.writeUInt32BE(value >>> 0);
    return written;
  });
  return Buffer.concat([length!, body, checksum!]);
};

const png = (width: number, height: number) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 1;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.alloc(8))), chunk("IEND", Buffer.alloc(0))]);
};

const bitmap = (width: number, height: number) => {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);
  return header;
};

const ico = (...images: Buffer[]) => {
  const directory = Buffer.alloc(6 + 16 * images.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);
  images.forEach((image, index) => {
    const before = images.slice(0, index).reduce((sum, { length }) => sum + length, 0);
    directory.writeUInt32LE(image.length, 6 + 16 * index + 8);
    directory.writeUInt32LE(directory.length + before, 6 + 16 * index + 12);
  });
  return Buffer.concat([directory, ...images]);
};

const svg = (content: string, before = "") => Buffer.from(`${before}<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24">${content}</svg>`);
const decoded = (url: string | null) => url && Buffer.from(url.split(",")[1]!, "base64").toString();

describe("raster icons", () => {
  test("are known by their bytes", () => {
    expect(iconDataUrl(png(64, 64))).toStartWith("data:image/png;base64,");
    expect(iconDataUrl(ico(bitmap(16, 16), png(256, 256)))).toStartWith("data:image/x-icon;base64,");
  });

  test("are refused when larger than 2048 pixels across or 256 KB, also inside an ICO", () => {
    expect(iconDataUrl(png(2048, 2048))).not.toBeNull();
    expect(iconDataUrl(png(2049, 16))).toBeNull();
    expect(iconDataUrl(png(16, 30000))).toBeNull();
    expect(iconDataUrl(ico(png(64, 64), png(30000, 30000)))).toBeNull();
    expect(iconDataUrl(ico(bitmap(30000, 16)))).toBeNull();
    expect(iconDataUrl(Buffer.concat([png(64, 64), Buffer.alloc(256 * 1024)]))).toBeNull();
  });

  test("are refused when cut short or empty", () => {
    expect(iconDataUrl(png(64, 64).subarray(0, 12))).toBeNull();
    expect(iconDataUrl(ico())).toBeNull();
    expect(iconDataUrl(ico(png(64, 64)).subarray(0, 24))).toBeNull();
    expect(iconDataUrl(new Uint8Array())).toBeNull();
  });
});

describe("plain SVG icons", () => {
  test("are taken as editors export them", () => {
    const exports = [
      svg('<path d="M0 0h9"/>'),
      svg('<title>Shop</title><style>.a{fill:url(#g)}</style><defs><linearGradient id="g"><stop stop-color="red"/></linearGradient></defs><rect class="a" width="9" height="9"/>', '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Made by hand -->\n'),
      svg('<rect width="9" height="9"/>', '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">'),
      svg('<g clip-path="url(#c)"><use xlink:href="#p"/></g><defs><clipPath id="c"><rect width="9" height="9"/></clipPath><path id="p" d="M0 0h9"/></defs>'),
      svg('<sodipodi:namedview/><metadata><rdf:RDF><cc:Work><dc:format>image/svg+xml</dc:format></cc:Work></rdf:RDF></metadata><svg:path d="M0 0h9"/>'),
    ];
    exports.forEach((each) => expect(iconDataUrl(each)).toStartWith("data:image/svg+xml;charset=utf-8;base64,"));
  });

  test("lose the encoding they declare, so a browser reads what was checked", () => {
    expect(decoded(iconDataUrl(svg("<g/>", '<?xml version="1.0" encoding="ISO-2022-JP"?>')))).toStartWith("<svg ");
  });

  test("are taken with outlines up to 256 KB, as those traced from a picture have", () => {
    const traced = (kilobytes: number) => svg(`<path fill="red" d="M0 0${"l1 1".repeat(Math.floor((kilobytes * 1024) / 4 / 5))}"/>`.repeat(5));
    expect(iconDataUrl(traced(159))).not.toBeNull();
    expect(iconDataUrl(traced(255))).not.toBeNull();
    expect(refusal(traced(257))).toBe("it is over 256 KB");
    expect(iconDataUrl(svg(`<polygon class='a' points='${"1 1 ".repeat(32 * 1024)}'/>`))).not.toBeNull();
  });

  const padding = " ".repeat(64 * 1024);
  const longBesidesOutlines: Record<string, Buffer> = {
    elements: svg("<g/>".repeat(17 * 1024)),
    "a style sheet": svg(`<style>${padding}</style>`),
    "a style sheet that reads like an outline": svg(`<style>/* path d="*/${padding}/*" */</style>`),
    "an outline's style": svg(`<path style="${padding}" d="M0 0"/>`),
    "an outline's style that reads like its data": svg(`<path style=' d="${padding}"'/>`),
    "the data of no outline": svg(`<g d="${padding}"/>`),
  };
  test.each(Object.entries(longBesidesOutlines))("are refused over 64 KB of %s", (_, each) => expect(refusal(each)).toBe("it is over 64 KB besides the outlines of its shapes"));

  test("are taken when they only mention a filter", () => {
    const named = '<g id="filter" class="icon-filter" style="color-interpolation-filters:sRGB"><title>Coffee filter</title></g>';
    expect(decoded(iconDataUrl(svg(named)))).toBe(svg(named).toString());
    expect(decoded(iconDataUrl(svg("<g/>", "<!-- filter: none -->")))).toBe(svg("<g/>").toString());
  });

  test("are taken as Mirador's own app icon, which has a shadow", () => {
    const drawn = decoded(iconDataUrl(readFileSync(join(import.meta.dir, "../desktop/assets/app-icon.svg"))));
    expect(drawn).toContain("<circle ");
    expect(drawn).not.toContain("filter");
  });

  const filtered: Record<string, [string, string]> = {
    "an element and the attribute naming it": ['<defs><filter id="s"><feDropShadow dy="1"/></filter></defs><rect width="9" filter="url(#s)" height="9"/>', '<defs></defs><rect width="9" height="9"/>'],
    "elements that are empty or prefixed": ['<filter id="a"/><filter/><g/><svg:filter id="b"><svg:feFlood/></svg:filter><g/>', "<g/><g/>"],
    "a property of a style attribute": ['<g style="fill:red;filter:url(#s);stroke:none"/>', '<g style="fill:red;stroke:none"/>'],
    "a property naming it in quotes": [
      `<g style="filter:url('#s');fill:red"/><g style='filter: url("#s")'/><g style="filter:url(&quot;#s&quot;);fill:red"/>`,
      `<g style="fill:red"/><g style=''/><g style="fill:red"/>`,
    ],
    "properties of a style sheet": ["<style>.a{FILTER:url(#s)}.b{-webkit-filter:blur(9px);backdrop-filter : blur(9px);fill:red}</style>", "<style>.a{}.b{fill:red}</style>"],
    "one that removing another puts together": ["<style>.a{fil<filter/>ter:blur(9px)}</style>", "<style>.a{}</style>"],
    "one its style sheet's comment or CDATA section splits": ["<style>.a{fil<!-- -->ter:blur(9px);fill:red}.b{fil<![CDATA[ter]]>:blur(9px)}</style>", "<style>.a{fill:red}.b{}</style>"],
  };
  test.each(Object.entries(filtered))("lose a filter: %s", (_, [given, left]) => expect(decoded(iconDataUrl(svg(given)))).toBe(svg(left).toString()));

  test("lose a doctype, as one for XHTML names characters that could spell a filter", () => {
    const xhtml = '<!DOCTYPE svg PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">';
    expect(decoded(iconDataUrl(svg('<g style="f&bsol;69lter:blur(9px)"/>', xhtml)))).toStartWith("<svg ");
  });

  test("keep a style sheet in a CDATA section, as some editors write it", () => {
    expect(decoded(iconDataUrl(svg("<style><![CDATA[g > rect{fill:red}]]></style><rect/>")))).toBe(svg("<style>g > rect{fill:red}</style><rect/>").toString());
  });

  test("are refused with the reason, for the host's log", () => {
    expect(refusal(Buffer.from("TOKEN=secret"))).toBe("it is no PNG, ICO or SVG");
    expect(refusal(svg('<image href="a.png"/>'))).toBe('it holds "<image", which is no plain shape');
    expect(refusal(svg("\u001b[31m<image/>"))).toBe("it holds control characters");
    expect(refusal(svg("<style>@import 'a.css'</style>"))).toBe('it holds "@import"');
    expect(refusal(png(64, 64).subarray(0, 12))).toBe("it is cut short or no readable text");
    expect(refusal(png(2049, 16))).toBe("it has no image, or one over 2048 pixels across");
  });

  test("are refused as no SVG, and in another encoding", () => {
    expect(iconDataUrl(Buffer.from("TOKEN=secret"))).toBeNull();
    expect(iconDataUrl(Buffer.from(svg("<g/>").toString(), "utf16le"))).toBeNull();
    expect(iconDataUrl(Buffer.from([...svg("<g/>"), 0xff]))).toBeNull();
  });

  const hostile: Record<string, Buffer> = {
    "a script": svg("<script>top.HACKED = 1</script>"),
    "a script under another prefix": svg('<x:script xmlns:x="http://www.w3.org/2000/svg">top.HACKED = 1</x:script>'),
    "HTML inside": svg("<foreignObject><iframe/></foreignObject>"),
    "another image": svg('<image href="http://example.com/a.png"/>'),
    "a pattern": svg('<pattern id="p"/>'),
    "an animation": svg('<rect><animate attributeName="x" dur="1s"/></rect>'),
    "entities": svg("&a;", '<!DOCTYPE svg [<!ENTITY a "aaaa">]>'),
    "a processing instruction": svg("<g/>", '<?xml-stylesheet href="a.css"?>'),
    "a filter parted from its colon": svg("<style>.a{filter/**/:blur(90px)}</style>"),
    "a filter a style sheet's element splits": svg("<style>.a{fil<g/>ter:blur(90px)}</style>"),
    "a filter an element splits in a style sheet that looks closed": svg('<style title="/>">.a{fil<title/>ter:blur(90px)}</style>'),
    "a filter making an image": svg("<style>svg{background-image:filter(linear-gradient(red,red),blur(90px))}</style>"),
    "a filter spelled with a CSS escape": svg('<g style="f\\69lter:blur(90px)"/>'),
    "a filter spelled with a character reference": svg('<g style="&#102;ilter:blur(90px)"/>'),
    "a drawing nested in an address": svg('<g style="mask-image:url(data:image/svg+xml;base64,AAAA)"/>'),
    "an imported style sheet": svg('<style>@import "a.css"</style>'),
    "a reference its style sheet repeats": svg('<style>rect{mask:url(#m)}</style><mask id="m"><rect width="9" height="9"/></mask>'),
    "references that multiply": svg(
      `<defs><g id="l0"><rect width="1" height="1"/></g>${[1, 2, 3, 4, 5, 6].map((level) => `<g id="l${level}">${`<use href="#l${level - 1}"/>`.repeat(10)}</g>`).join("")}</defs><use href="#l6"/>`,
    ),
  };
  test.each(Object.entries(hostile))("are refused with %s", (_, each) => expect(iconDataUrl(each)).toBeNull());
});
