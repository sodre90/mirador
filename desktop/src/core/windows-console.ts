/**
 * Sends Ctrl-C to every process on the console `pid` runs in, which Windows lets only a process attached to that
 * console do. A process has one console, so this runs in a Bun of its own: attaching would take the app off its own.
 */
const interruptScript = (pid: number) => `
import { dlopen, FFIType } from "bun:ffi";
const kernel32 = dlopen("kernel32.dll", {
  FreeConsole: { args: [], returns: FFIType.i32 },
  AttachConsole: { args: [FFIType.u32], returns: FFIType.i32 },
  SetConsoleCtrlHandler: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  GenerateConsoleCtrlEvent: { args: [FFIType.u32, FFIType.u32], returns: FFIType.i32 },
}).symbols;
kernel32.FreeConsole();
if (!kernel32.AttachConsole(${pid})) process.exit(1);
kernel32.SetConsoleCtrlHandler(null, 1);
process.exit(kernel32.GenerateConsoleCtrlEvent(0, 0) ? 0 : 1);
`;

/** True when the event went out; the processes on that console then stop as they do on SIGINT. */
export async function interruptConsoleOf(pid: number) {
  const helper = Bun.spawn([process.execPath, "-e", interruptScript(pid)], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true });
  return (await helper.exited) === 0;
}
