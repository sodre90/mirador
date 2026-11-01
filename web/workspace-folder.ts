/** A Windows path starts with a drive or a share, and takes \ or / between its folders. */
const isWindowsPath = (path: string) => /^([A-Za-z]:|\\\\)/.test(path);

/** The path with the home directory as ~; as it is outside home, and until the host has said where home is. */
export function withHomeAsTilde(path: string, homeDir: string): string {
  if (homeDir && path === homeDir) return "~";
  const separator = isWindowsPath(homeDir) ? "\\" : "/";
  return homeDir && path.startsWith(`${homeDir}${separator}`) ? `~${path.slice(homeDir.length)}` : path;
}

/** Shown under a workspace's name: the folder that holds it, with the home directory as ~. */
export function parentFolder(path: string, homeDir: string): string {
  return withHomeAsTilde(isWindowsPath(path) ? windowsParentFolder(path) : posixParentFolder(path), homeDir);
}

const posixParentFolder = (path: string) => path.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/";

function windowsParentFolder(path: string) {
  const parent = path.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "");
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}
