import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { machOFiles } from "../desktop/scripts/sign-macos-app.ts";

const app = mkdtempSync(join(tmpdir(), "mirador-sign-"));
afterAll(() => rmSync(app, { recursive: true, force: true }));

const write = (path: string, bytes: Buffer) => {
  mkdirSync(dirname(join(app, path)), { recursive: true });
  writeFileSync(join(app, path), bytes);
};

/** A 64-bit Mach-O header: magic, CPU type, CPU subtype, file type. */
const thinHeader = (fileType: number) => {
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(0x0100000c, 4);
  header.writeUInt32LE(fileType, 12);
  return header;
};
const MH_EXECUTE = 2;
const MH_DYLIB = 6;

/** A universal binary whose first architecture's slice starts at 64. */
const fatBinary = (slice: Buffer) => {
  const header = Buffer.alloc(64);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(1, 4);
  header.writeUInt32BE(0x0100000c, 8);
  header.writeUInt32BE(64, 16);
  return Buffer.concat([header, slice]);
};

/** A Java class file: the same magic as a universal binary, then its version (52 is Java 8). */
const javaClass = () => {
  const bytes = Buffer.alloc(64);
  bytes.writeUInt32BE(0xcafebabe, 0);
  bytes.writeUInt32BE(52, 4);
  bytes.writeUInt32BE(64, 16);
  return Buffer.concat([bytes, thinHeader(MH_EXECUTE)]);
};

test.skipIf(process.platform === "win32")("every program and library in the app is found by its header, the deepest first, and nothing else is", () => {
  write("Contents/MacOS/launcher", thinHeader(MH_EXECUTE));
  write("Contents/MacOS/libNativeWrapper.dylib", thinHeader(MH_DYLIB));
  write("Contents/Resources/uninstall", fatBinary(thinHeader(MH_EXECUTE)));
  write("Contents/Resources/app/vendor/tool", thinHeader(MH_EXECUTE));
  write("Contents/Resources/app/vendor/Helper.class", javaClass());
  write("Contents/Resources/app/index.js", Buffer.from("console.log('not a program')\n"));
  write("Contents/Resources/app/empty", Buffer.alloc(0));

  expect(machOFiles(app).map(({ path, kind }) => [relative(app, path), kind])).toEqual([
    ["Contents/Resources/app/vendor/tool", "executable"],
    ["Contents/MacOS/launcher", "executable"],
    ["Contents/MacOS/libNativeWrapper.dylib", "library"],
    ["Contents/Resources/uninstall", "executable"],
  ]);
});
