import { describe, expect, test } from "bun:test";
import { crc32, deflateSync } from "node:zlib";
import { iconDataUrl } from "../host/icon-image.ts";

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

  test("are refused over 64 KB, as no SVG, and in another encoding", () => {
    expect(iconDataUrl(svg("<g/>".repeat(17 * 1024)))).toBeNull();
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
    "a filter": svg('<g style="filter:blur(90px)"/>'),
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
