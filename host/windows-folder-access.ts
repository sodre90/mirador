import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** SDDL's names for SYSTEM, Administrators and the computer's built-in Administrator account. */
const ADMINISTRATION = ["SY", "BA", "LA"];
/** Full control of the folder, and of every folder and file in it through inheritance. */
const FULL_CONTROL_WITHIN = "(OI)(CI)F";

/** Git for Windows puts MSYS programs of the same names on PATH, which take other arguments. */
const system32 = (program: string) => join(process.env.SystemRoot ?? "C:\\Windows", "System32", program);

function run(program: string, args: string[]) {
  const { success, stdout, stderr } = Bun.spawnSync([system32(program), ...args]);
  if (!success) throw new Error(`${program} ${args[0]} failed: ${(stderr.toString() || stdout.toString()).trim()}`);
  return stdout.toString();
}

let accountSid: string | undefined;

/** The account the host runs as, by SID, which icacls takes whatever the account's name or the system's language. */
function hostAccountSid() {
  accountSid ??= /"(S-1-[\d-]+)"\s*$/.exec(run("whoami.exe", ["/user", "/fo", "csv", "/nh"]))?.[1];
  if (!accountSid) throw new Error("whoami did not name the account the host runs as");
  return accountSid;
}

/** Whom the folder grants anything, as icacls saves its access list: SDDL, in UTF-16. */
function grantees(folder: string) {
  const saved = mkdtempSync(join(tmpdir(), "mirador-access-"));
  try {
    run("icacls.exe", [folder, "/save", join(saved, "access"), "/q"]);
    return [...readFileSync(join(saved, "access"), "utf16le").matchAll(/\(A;[^;]*;[^;]*;[^;]*;[^;]*;([^)]+)\)/g)].map(([, sid]) => sid!);
  } finally {
    rmSync(saved, { recursive: true, force: true });
  }
}

/**
 * Leaves the folder to the host's account, SYSTEM and Administrators, as chmod 0o700 does on Unix, where Windows ignores
 * modes: a folder outside the user's profile, such as C:\mirador, otherwise inherits access for every local account.
 * One icacls call grants before it drops what the folder inherits, so the account never loses access, and the folders
 * and files already in it inherit the same three. Access someone gave the folder itself stays, so it throws naming
 * whom; it throws too where it cannot, e.g. on a FAT drive, which has no access control.
 */
export function keepFolderToHostAccount(folder: string) {
  const account = hostAccountSid();
  run("icacls.exe", [folder, "/grant:r", ...[account, "S-1-5-18", "S-1-5-32-544"].map((sid) => `*${sid}:${FULL_CONTROL_WITHIN}`), "/inheritance:r", "/q"]);
  const others = grantees(folder).filter((sid) => sid !== account && !ADMINISTRATION.includes(sid));
  if (others.length > 0) throw new Error(`the folder still grants access to ${others.join(", ")} as well`);
}

/** At every start, where chmod 0o700 does nothing. A folder it cannot keep stays as it is, with a warning, so the host still starts. */
export function keepDataFolderToHostAccount(dataDir: string) {
  try {
    keepFolderToHostAccount(dataDir);
  } catch (error) {
    console.warn(`could not leave the data folder ${dataDir} to this account alone: ${error instanceof Error ? error.message : error}`);
  }
}
