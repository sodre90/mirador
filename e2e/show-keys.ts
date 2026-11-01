/**
 * Run with Bun in a Windows terminal tab: shows the keys, wheel and mouse the terminal sends, as cat -v does, until Ctrl+C.
 * The console passes them on as the terminal wrote them only in virtual terminal input mode, which this sets. With
 * --follow-mouse it then asks the terminal to report the mouse, which the console passes on only from a program in that
 * mode, not from PowerShell. Then it prints the text it was given, so a spec waits for that before it sends anything.
 */
import { dlopen, FFIType } from "bun:ffi";
import { writeSync } from "node:fs";
import { parseArgs } from "node:util";

const STD_INPUT_HANDLE = -10;
const ENABLE_VIRTUAL_TERMINAL_INPUT = 0x0200;
const CTRL_C = 0x03;
const MOUSE_REPORTS_AS_SGR = "\x1b[?1000h\x1b[?1006h";

const { GetStdHandle, SetConsoleMode, ReadFile } = dlopen("kernel32.dll", {
  GetStdHandle: { args: [FFIType.i32], returns: FFIType.ptr },
  SetConsoleMode: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  ReadFile: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
}).symbols;

const visible = (byte: number) => (byte < 0x20 ? `^${String.fromCharCode(byte + 0x40)}` : byte === 0x7f ? "^?" : String.fromCharCode(byte));

const { values, positionals } = parseArgs({ options: { "follow-mouse": { type: "boolean" } }, allowPositionals: true });
const input = GetStdHandle(STD_INPUT_HANDLE);
SetConsoleMode(input, ENABLE_VIRTUAL_TERMINAL_INPUT);
if (values["follow-mouse"]) writeSync(1, MOUSE_REPORTS_AS_SGR);
writeSync(1, `${positionals.join(" ")}\r\n`);
const buffer = new Uint8Array(256);
const bytesRead = new Uint32Array(1);
while (ReadFile(input, buffer, buffer.length, bytesRead, null)) {
  const bytes = [...buffer.subarray(0, bytesRead[0])];
  if (bytes.includes(CTRL_C)) break;
  writeSync(1, bytes.map(visible).join(""));
}
