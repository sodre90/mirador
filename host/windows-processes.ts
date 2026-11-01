import { dlopen, FFIType } from "bun:ffi";
import { programName } from "./command-shell.ts";

export type WindowsProcess = { pid: number; parentPid: number; startedAt: number; name: string };

const TH32CS_SNAPPROCESS = 0x2;
const INVALID_HANDLE_VALUE = 0xffffffffffffffffn;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
/** PROCESSENTRY32W as 64-bit Windows lays it out. */
const PROCESS_ENTRY = { size: 568, pid: 8, parentPid: 32, exeFile: 44, exeFileBytes: 520 } as const;
/** A FILETIME counts 100 ns intervals since 1601. */
const FILETIME_AT_1970 = 116444736000000000n;
const UTF16 = new TextDecoder("utf-16le");

const openKernel32 = () =>
  dlopen("kernel32.dll", {
    CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: FFIType.u64 },
    Process32FirstW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    Process32NextW: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
    OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.u64 },
    GetProcessTimes: { args: [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    SetConsoleCtrlHandler: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  }).symbols;

let kernel32Functions: ReturnType<typeof openKernel32> | undefined;
/** kernel32 is there only on Windows, so it is opened at its first use rather than as the module loads. */
const kernel32 = () => (kernel32Functions ??= openKernel32());

/**
 * A process that ignores Ctrl+C hands that on to every process it starts, and ssh, among others, starts its sessions so:
 * a host started there would leave the programs in its terminal tabs deaf to Ctrl+C. The host takes Ctrl+C again, and
 * quits on it as it does on SIGINT elsewhere.
 */
export const stopIgnoringCtrlC = () => kernel32().SetConsoleCtrlHandler(null, 0) !== 0;

function* processEntries(snapshot: bigint) {
  const { Process32FirstW, Process32NextW } = kernel32();
  const entry = new Uint8Array(PROCESS_ENTRY.size);
  const fields = new DataView(entry.buffer);
  fields.setUint32(0, PROCESS_ENTRY.size, true);
  for (let found = Process32FirstW(snapshot, entry); found; found = Process32NextW(snapshot, entry)) {
    const exeFile = UTF16.decode(entry.subarray(PROCESS_ENTRY.exeFile, PROCESS_ENTRY.exeFile + PROCESS_ENTRY.exeFileBytes));
    yield { pid: fields.getUint32(PROCESS_ENTRY.pid, true), parentPid: fields.getUint32(PROCESS_ENTRY.parentPid, true), name: exeFile.split("\0")[0]! };
  }
}

/** When the process started, in microseconds since 1970; null for one this account may not look into. */
function startOf(pid: number): number | null {
  const { OpenProcess, GetProcessTimes, CloseHandle } = kernel32();
  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (handle === 0n) return null;
  const creation = new BigUint64Array(1);
  const unused = () => new BigUint64Array(1);
  const known = GetProcessTimes(handle, creation, unused(), unused(), unused());
  CloseHandle(handle);
  return known ? Number((creation[0]! - FILETIME_AT_1970) / 10n) : null;
}

/** Every running process this account can see the start of: one it cannot is not one Mirador started. */
export function processSnapshot(): WindowsProcess[] {
  const snapshot = kernel32().CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot === INVALID_HANDLE_VALUE) return [];
  try {
    return [...processEntries(snapshot)].flatMap((entry) => {
      const startedAt = startOf(entry.pid);
      return startedAt === null ? [] : [{ ...entry, startedAt }];
    });
  } finally {
    kernel32().CloseHandle(snapshot);
  }
}

/**
 * The processes `parent` started. Windows keeps a process's parent pid after that parent exits, and gives the pid to
 * later processes, so a process only counts as a child of one that started before it.
 */
const childrenOf = (parent: WindowsProcess, processes: WindowsProcess[]) =>
  processes.filter(({ parentPid, startedAt }) => parentPid === parent.pid && startedAt > parent.startedAt);

/** The processes `pid` started, and the ones they started, at any depth. */
export function descendantsOf(pid: number, processes: WindowsProcess[]): WindowsProcess[] {
  const descendantsBelow = (parent: WindowsProcess): WindowsProcess[] =>
    childrenOf(parent, processes).flatMap((child) => [child, ...descendantsBelow(child)]);
  const root = processes.find((process) => process.pid === pid);
  return root ? descendantsBelow(root) : [];
}

/** Git Bash's bash.exe only starts the real bash: one Stop kills before it has done so would leave that bash running. */
const LOOK_AGAIN_AFTER_MS = [100, 250, 500, 1000];

const taskkill = (pids: number[]): Promise<unknown> =>
  Bun.spawn(["taskkill", "/F", ...pids.flatMap((pid) => ["/PID", String(pid)])], { stdout: "ignore", stderr: "ignore", windowsHide: true }).exited;

const sameProcess = (one: WindowsProcess) => (other: WindowsProcess) => other.pid === one.pid && other.startedAt === one.startedAt;

/** In microseconds since 1970, as a process's start is. */
const microsecondsNow = () => Date.now() * 1000;

/**
 * Windows has no hangup and no process groups: a process and everything it started end together only this way, all at
 * once: Git Bash's fork copies a child from its parent, and a child whose parent died first says so in its output.
 * Settles once the tree as it stands is dead; a process the tree was starting as it was killed shows up only later, as
 * a child of a killed one, so the tree is looked at again a few times after, until `lateStartersKilled` settles. A
 * process that started after the one it names as parent was killed got that pid reused, and is no one's to kill.
 */
export async function killProcessTree(
  pid: number,
  { snapshot = processSnapshot, kill = taskkill, lookAgainAfterMs = LOOK_AGAIN_AFTER_MS } = {},
): Promise<{ lateStartersKilled: Promise<void> }> {
  const root = snapshot().find((process) => process.pid === pid);
  if (!root) {
    await kill([pid]);
    return { lateStartersKilled: Promise.resolve() };
  }
  const killed: (WindowsProcess & { killedAt: number })[] = [];
  const startedBeforeItsParentWasKilled = ({ parentPid, startedAt }: WindowsProcess) =>
    killed.filter(({ pid }) => pid === parentPid).every(({ killedAt }) => startedAt <= killedAt);
  const killWhatIsLeft = async () => {
    const tree = [root, ...descendantsOf(root.pid, [root, ...killed, ...snapshot().filter(startedBeforeItsParentWasKilled)])];
    const unkilled = tree.filter((process, index) => tree.findIndex(sameProcess(process)) === index && !killed.some(sameProcess(process)));
    if (unkilled.length === 0) return;
    await kill(unkilled.map((process) => process.pid));
    const killedAt = microsecondsNow();
    killed.push(...unkilled.map((process) => ({ ...process, killedAt })));
  };
  await killWhatIsLeft();
  const lateStartersKilled = (async () => {
    for (const pause of lookAgainAfterMs) {
      await Bun.sleep(pause);
      await killWhatIsLeft();
    }
  })();
  return { lateStartersKilled };
}

/** The programs `pid` started that still run, by name. */
export function childProgramNames(pid: number): string[] {
  const processes = processSnapshot();
  const parent = processes.find((process) => process.pid === pid);
  return parent ? childrenOf(parent, processes).map(({ name }) => programName(name)) : [];
}
