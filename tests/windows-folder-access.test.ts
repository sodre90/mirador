import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keepFolderToHostAccount } from "../host/windows-folder-access.ts";

const POWERSHELL_TIMEOUT_MS = 30_000;
const LOCAL_SYSTEM = "S-1-5-18";
const ADMINISTRATORS = "S-1-5-32-544";
const USERS = "S-1-5-32-545";

const system32 = (program: string) => join(process.env.SystemRoot ?? "C:\\Windows", "System32", program);
const icacls = (...args: string[]) => expect(Bun.spawnSync([system32("icacls.exe"), ...args]).success).toBe(true);

/**
 * Who may use the path, by SID, and whether each grant comes from the folder it is in. Through .NET rather than Get-Acl:
 * a Windows PowerShell started under PowerShell 7, as CI runs the tests, cannot load Get-Acl's module from PowerShell 7's
 * PSModulePath.
 */
function grantsOn(path: string) {
  const script = [
    "$acl = if ([IO.Directory]::Exists($env:GRANTS_OF)) { [IO.Directory]::GetAccessControl($env:GRANTS_OF) } else { [IO.File]::GetAccessControl($env:GRANTS_OF) }",
    "foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) { $rule.IdentityReference.Value + ' ' + $rule.IsInherited }",
  ].join("\n");
  const { success, stdout, stderr } = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, GRANTS_OF: path } });
  if (!success) throw new Error(`could not read the access list of ${path}: ${stderr.toString()}`);
  return stdout
    .toString()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [sid, inherited] = line.trim().split(" ");
      return { sid: sid!, inherited: inherited === "True" };
    })
    .sort((one, other) => one.sid.localeCompare(other.sid));
}

const hostAccount = () => /"(S-1-[\d-]+)"\s*$/.exec(Bun.spawnSync([system32("whoami.exe"), "/user", "/fo", "csv", "/nh"]).stdout.toString())![1]!;

describe("keepFolderToHostAccount", () => {
  test.if(process.platform === "win32")(
    "leaves a data folder that inherited access for every local account to the host's account, SYSTEM and Administrators, with the files already in it",
    () => {
      const parent = mkdtempSync(join(tmpdir(), "mirador-folder-access-"));
      const dataDir = join(parent, "data");
      try {
        icacls(parent, "/grant", `*${USERS}:(OI)(CI)RX`);
        mkdirSync(dataDir);
        writeFileSync(join(dataDir, "browser-token"), "secret");
        expect(grantsOn(dataDir).map(({ sid }) => sid)).toContain(USERS);

        keepFolderToHostAccount(dataDir);

        const keptTo = [hostAccount(), LOCAL_SYSTEM, ADMINISTRATORS].sort();
        expect(grantsOn(dataDir)).toEqual(keptTo.map((sid) => ({ sid, inherited: false })));
        expect(grantsOn(join(dataDir, "browser-token"))).toEqual(keptTo.map((sid) => ({ sid, inherited: true })));
        writeFileSync(join(dataDir, "config.json"), "{}");
        expect(readFileSync(join(dataDir, "browser-token"), "utf8")).toBe("secret");
      } finally {
        icacls(parent, "/reset", "/t", "/q");
        rmSync(parent, { recursive: true, force: true });
      }
    },
    POWERSHELL_TIMEOUT_MS,
  );

  test.if(process.platform === "win32")(
    "names whom the data folder itself still grants access to, as only the access it inherits goes",
    () => {
      const dataDir = mkdtempSync(join(tmpdir(), "mirador-folder-access-"));
      try {
        icacls(dataDir, "/grant", `*${USERS}:(OI)(CI)RX`);
        expect(() => keepFolderToHostAccount(dataDir)).toThrow("the folder still grants access to BU as well");
      } finally {
        icacls(dataDir, "/reset", "/t", "/q");
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
    POWERSHELL_TIMEOUT_MS,
  );

  test.if(process.platform === "win32")("says why when the folder cannot be kept, rather than leaving it as it was without a word", () => {
    expect(() => keepFolderToHostAccount(join(tmpdir(), "mirador-no-such-folder", "data"))).toThrow(/^icacls\.exe .* failed: /);
  });
});
