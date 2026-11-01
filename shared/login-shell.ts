import { userInfo } from "node:os";

/** The shell in a user record, as printed by `getent passwd <name>` or `dscl . -read /Users/<name> UserShell`. */
export function shellInUserRecord(record: string): string | undefined {
  const shell = record.trim().split(":").at(-1)?.trim();
  return shell?.startsWith("/") ? shell : undefined;
}

/**
 * Bun reports os.userInfo().shell, and on Linux the username too, as "unknown", so the shell is read from the user database.
 * A Windows account has no shell of its own.
 */
export function accountShell(platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform === "win32") return undefined;
  const lookup =
    platform === "darwin" ? ["dscl", ".", "-read", `/Users/${userInfo().username}`, "UserShell"] : ["getent", "passwd", String(process.getuid!())];
  try {
    return shellInUserRecord(Bun.spawnSync(lookup, { stdout: "pipe", stderr: "ignore" }).stdout.toString());
  } catch {
    return undefined;
  }
}
