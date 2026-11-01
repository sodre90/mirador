import { dlopen, FFIType } from "bun:ffi";

/** Takes REG_EXPAND_SZ values too, expanded. */
const RRF_RT_REG_SZ = 0x2;
const RRF_RT_REG_EXPAND_SZ = 0x4;
const RRF_NOEXPAND = 0x10000000;
const AS_WRITTEN = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND;
const REG_EXPAND_SZ = 2;
const HKEY_LOCAL_MACHINE = 0xffffffff80000002n;
const HKEY_CURRENT_USER = 0xffffffff80000001n;
const MACHINE_ENVIRONMENT = "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";
const USER_ENVIRONMENT = "Environment";
/** Room for the longest environment variable Windows allows, 32,767 characters, and its NUL. */
const VALUE_BYTES = 32_768 * 2;

const openAdvapi32 = () =>
  dlopen("advapi32.dll", {
    RegGetValueW: { args: [FFIType.u64, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  }).symbols;

let advapi32Functions: ReturnType<typeof openAdvapi32> | undefined;
/** There only on Windows, so opened at its first use rather than as the module loads. */
const advapi32 = () => (advapi32Functions ??= openAdvapi32());

const wide = (text: string) => Buffer.from(`${text}\0`, "utf16le");

/** The size Windows gives an expanded value can run past its text, so the text ends at its first NUL. */
function registryValue(key: bigint, subkey: string, name: string, flags = RRF_RT_REG_SZ) {
  const data = Buffer.alloc(VALUE_BYTES);
  const size = new Uint32Array([data.byteLength]);
  const type = new Uint32Array(1);
  if (advapi32().RegGetValueW(key, wide(subkey), wide(name), flags, type, data, size) !== 0) return undefined;
  return { text: data.subarray(0, size[0]).toString("utf16le").split("\0")[0]!, expands: type[0] === REG_EXPAND_SZ };
}

/** Each %name% replaced by its value, where there is one; Windows leaves the others as written. */
export const expandVariables = (text: string, valueOf: (name: string) => string | undefined) =>
  text.replace(/%([^%;]+)%/g, (reference, name: string) => valueOf(name) ?? reference);

const hostVariable = (name: string) => Object.entries(process.env).find(([variable]) => variable.toUpperCase() === name.toUpperCase())?.[1];

/** The registry first: a variable set since the host started, like the one IDEA's installer names in its %IntelliJ IDEA% PATH entry, is only there. */
const variable = (name: string) =>
  registryValue(HKEY_CURRENT_USER, USER_ENVIRONMENT, name)?.text ?? registryValue(HKEY_LOCAL_MACHINE, MACHINE_ENVIRONMENT, name)?.text ?? hostVariable(name);

function registryPathIn(key: bigint, subkey: string) {
  const path = registryValue(key, subkey, "Path", AS_WRITTEN);
  if (!path) return "";
  return path.expands ? expandVariables(path.text, variable) : path.text;
}

/** The machine's PATH and then the user's, as Windows gives them to a program started now. */
const registryPath = () => `${registryPathIn(HKEY_LOCAL_MACHINE, MACHINE_ENVIRONMENT)};${registryPathIn(HKEY_CURRENT_USER, USER_ENVIRONMENT)}`;

/** Windows names a folder in any case, with or without a backslash at its end. */
const folderKey = (folder: string) => folder.replace(/\\+$/, "").toLowerCase();

/** `path`'s own folders, then those of `added` that it lacks, each once, as first named. */
export function withFolders(path: string | undefined, added: string) {
  const folders = new Map<string, string>();
  for (const folder of [...(path ?? "").split(";"), ...added.split(";")]) {
    if (folder && !folders.has(folderKey(folder))) folders.set(folderKey(folder), folder);
  }
  return [...folders.values()].join(";");
}

/**
 * The PATH to look programs up on and start them with. A Windows program keeps the PATH it started with, so the host
 * would not find one installed since until it restarted: there the folders the registry has gained come after its own.
 */
export const currentPath = (path = process.env.PATH, platform = process.platform) => (platform === "win32" ? withFolders(path, registryPath()) : path);

/** The host's environment with the current PATH, for the agents and terminals it starts. */
export const hostEnvironment = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "PATH")),
  PATH: currentPath(),
});
