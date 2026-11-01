// Packs square PNGs into one .ico: Windows loads tray icons with LoadImageW(IMAGE_ICON), which reads .ico but not .png.
// Usage: bun scripts/pack-ico.ts out.ico a.png b.png …
const [output, ...inputs] = process.argv.slice(2);
if (!output || inputs.length === 0) throw new Error("Usage: bun scripts/pack-ico.ts out.ico a.png b.png …");

const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;

const images = await Promise.all(inputs.map(async (path) => new Uint8Array(await Bun.file(path).arrayBuffer())));
const widthOf = (png: Uint8Array) => new DataView(png.buffer).getUint32(16);

const header = new DataView(new ArrayBuffer(HEADER_BYTES + ENTRY_BYTES * images.length));
header.setUint16(2, 1, true);
header.setUint16(4, images.length, true);
images.reduce((offset, png, index) => {
  const entry = HEADER_BYTES + ENTRY_BYTES * index;
  const size = widthOf(png) >= 256 ? 0 : widthOf(png);
  header.setUint8(entry, size);
  header.setUint8(entry + 1, size);
  header.setUint16(entry + 4, 1, true);
  header.setUint16(entry + 6, 32, true);
  header.setUint32(entry + 8, png.length, true);
  header.setUint32(entry + 12, offset, true);
  return offset + png.length;
}, header.byteLength);

await Bun.write(output, new Blob([header.buffer, ...images]));
