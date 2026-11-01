import { dlopen, FFIType, toArrayBuffer } from "bun:ffi";

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const STILL_ACTIVE = 259;
const PROCESS_BASIC_INFORMATION = 0;
const PROCESS_COMMAND_LINE_INFORMATION = 60;
/** PROCESS_BASIC_INFORMATION as 64-bit Windows lays it out; the parent is the pid the process inherited from. */
const BASIC_INFORMATION = { parentAt: 40, bytes: 48 } as const;
/** A UNICODE_STRING as 64-bit Windows lays it out (its length in bytes, then a pointer to the text), and room for the longest command line. */
const COMMAND_LINE_INFORMATION = { lengthAt: 0, textAt: 8, bytes: 16 + 32_768 * 2 } as const;
const UTF16 = new TextDecoder("utf-16le");

const openKernel32 = () =>
  dlopen("kernel32.dll", {
    OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.u64 },
    GetExitCodeProcess: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
  }).symbols;

const openNtdll = () =>
  dlopen("ntdll.dll", {
    NtQueryInformationProcess: { args: [FFIType.u64, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
  }).symbols;

let kernel32Functions: ReturnType<typeof openKernel32> | undefined;
let ntdllFunctions: ReturnType<typeof openNtdll> | undefined;
/** These are there only on Windows, so they are opened at their first use rather than as the module loads. */
const kernel32 = () => (kernel32Functions ??= openKernel32());
const ntdll = () => (ntdllFunctions ??= openNtdll());

function isRunning(handle: bigint) {
  const exitCode = new Uint32Array(1);
  return kernel32().GetExitCodeProcess(handle, exitCode) !== 0 && exitCode[0] === STILL_ACTIVE;
}

function commandLineThrough(handle: bigint) {
  const information = new Uint8Array(COMMAND_LINE_INFORMATION.bytes);
  const status = ntdll().NtQueryInformationProcess(handle, PROCESS_COMMAND_LINE_INFORMATION, information, information.byteLength, null);
  if (status !== 0) return null;
  const fields = new DataView(information.buffer);
  const length = fields.getUint16(COMMAND_LINE_INFORMATION.lengthAt, true);
  if (length === 0) return "";
  return UTF16.decode(toArrayBuffer(Number(fields.getBigUint64(COMMAND_LINE_INFORMATION.textAt, true)), 0, length));
}

function parentThrough(handle: bigint) {
  const information = new Uint8Array(BASIC_INFORMATION.bytes);
  const status = ntdll().NtQueryInformationProcess(handle, PROCESS_BASIC_INFORMATION, information, information.byteLength, null);
  return status === 0 ? Number(new DataView(information.buffer).getBigUint64(BASIC_INFORMATION.parentAt, true)) : null;
}

function queryRunning<T>(pid: number, query: (handle: bigint) => T | null): T | null {
  const handle = kernel32().OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (handle === 0n) return null;
  try {
    return isRunning(handle) ? query(handle) : null;
  } finally {
    kernel32().CloseHandle(handle);
  }
}

/** The command line a running process was started with; null once it has exited, or for one this account may not look into. */
export const commandLineOf = (pid: number): string | null => queryRunning(pid, commandLineThrough);

/** The pid of the process that started a running one, which may have exited since and its pid gone to another. */
export const parentOf = (pid: number): number | null => queryRunning(pid, parentThrough);
