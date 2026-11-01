#!/usr/bin/env bun
/**
 * Signs a built Mirador.app with the Developer ID in the login keychain, has Apple's notary service check it and
 * staples the ticket, so a downloaded copy opens without clearing its quarantine. Usage: sign-macos-app.ts <Mirador.app>
 * The login keychain holds the notary key under the profile name `xcrun notarytool store-credentials` was given.
 * When Apple takes longer than the wait, `sign-macos-app.ts --staple <Mirador.app>` finishes once it accepted the app.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readdirSync, readSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";

/** codesign takes any identity whose name contains this, and refuses when two do. */
const SIGNING_IDENTITY = "Developer ID Application";
export const NOTARY_PROFILE = "mirador-notary";
/** Unlike the data-protection keychain notarytool uses by default, it stays readable while the Mac's screen is locked. */
export const LOGIN_KEYCHAIN = join(homedir(), "Library", "Keychains", "login.keychain-db");
export const NOTARY_CREDENTIALS = ["--keychain-profile", NOTARY_PROFILE, "--keychain", LOGIN_KEYCHAIN];
const ENTITLEMENTS = join(import.meta.dir, "..", "entitlements.plist");
/** Apple can take more than an hour, most of all with a new team's first submissions. */
const NOTARY_TIMEOUT = "2h";

const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const MH_EXECUTE = 2;
/** Java class files start with the same magic; the field after it is their version, at least 45, where a fat binary counts its few architectures. */
const MOST_FAT_ARCHITECTURES = 30;

export type MachOKind = "executable" | "library";

function bytesAt(file: number, position: number, length: number) {
  const bytes = Buffer.alloc(length);
  return bytes.subarray(0, readSync(file, bytes, 0, length, position));
}

function kindAt(file: number, position: number): MachOKind | null {
  const header = bytesAt(file, position, 20);
  if (header.length < 16) return null;
  if (header.readUInt32LE(0) === MH_MAGIC_64) return header.readUInt32LE(12) === MH_EXECUTE ? "executable" : "library";
  const isFat = header.length === 20 && header.readUInt32BE(0) === FAT_MAGIC && header.readUInt32BE(4) < MOST_FAT_ARCHITECTURES;
  return isFat && position === 0 ? kindAt(file, header.readUInt32BE(16)) : null;
}

export function machOKind(path: string): MachOKind | null {
  const file = openSync(path, "r");
  try {
    return kindAt(file, 0);
  } finally {
    closeSync(file);
  }
}

const depth = (path: string) => path.split(sep).length;

/** Every program and library in the app, the deepest first, as each must be signed before what holds it. */
export function machOFiles(app: string): { path: string; kind: MachOKind }[] {
  return readdirSync(app, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .flatMap((path) => {
      const kind = machOKind(path);
      return kind ? [{ path, kind }] : [];
    })
    .sort((one, other) => depth(other.path) - depth(one.path) || one.path.localeCompare(other.path));
}

const run = (command: string, args: string[]) => execFileSync(command, args, { stdio: "inherit" });

/** Libraries take no entitlements: the program that loads them has them. */
function sign(path: string, kind: MachOKind | "app") {
  const entitlements = kind === "library" ? [] : ["--entitlements", ENTITLEMENTS];
  run("codesign", ["--force", "--options", "runtime", "--timestamp", ...entitlements, "--sign", SIGNING_IDENTITY, path]);
}

/** The hardened runtime stops a program at its first JIT step, not when it is signed or notarized. */
function checkBunRuns(app: string) {
  const hotLoop = "let sum = 0; for (let i = 0; i < 10_000_000; i++) sum += i; console.log(sum)";
  const output = execFileSync(join(app, "Contents", "MacOS", "bun"), ["-e", hotLoop], { encoding: "utf8" });
  if (output.trim() !== "49999995000000") throw new Error(`The signed Bun printed ${JSON.stringify(output)} instead of the loop's sum.`);
}

const notarytool = (args: string[]) =>
  execFileSync("xcrun", ["notarytool", ...args, ...NOTARY_CREDENTIALS], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

function submit(app: string) {
  const folder = mkdtempSync(join(tmpdir(), "mirador-notarize-"));
  try {
    const zip = join(folder, "Mirador.zip");
    run("ditto", ["-c", "-k", "--keepParent", app, zip]);
    return (JSON.parse(notarytool(["submit", zip, "--output-format", "json"])) as { id: string }).id;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** Ends when Apple decided, or when the wait ran out; the submission's status says which. */
function waitForApple(id: string) {
  spawnSync("xcrun", ["notarytool", "wait", id, ...NOTARY_CREDENTIALS, "--timeout", NOTARY_TIMEOUT], { stdio: "inherit" });
}

function notarize(app: string) {
  const id = submit(app);
  waitForApple(id);
  const { status } = JSON.parse(notarytool(["info", id, "--output-format", "json"])) as { status: string };
  if (status === "In Progress") {
    throw new Error(
      `Apple is still checking submission ${id}. Once \`xcrun notarytool info ${id} ${NOTARY_CREDENTIALS.join(" ")}\` says Accepted, run make macos-staple.`,
    );
  }
  if (status !== "Accepted") {
    run("xcrun", ["notarytool", "log", id, ...NOTARY_CREDENTIALS]);
    throw new Error(`Apple's notary service answered ${status} for submission ${id}.`);
  }
}

function staple(app: string) {
  run("xcrun", ["stapler", "staple", app]);
  run("xcrun", ["stapler", "validate", app]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=4", app]);
}

export function signAndNotarize(app: string) {
  run("xattr", ["-cr", app]);
  machOFiles(app).forEach(({ path, kind }) => sign(path, kind));
  sign(app, "app");
  run("codesign", ["--verify", "--strict", "--deep", "--verbose=2", app]);
  checkBunRuns(app);
  notarize(app);
  staple(app);
}

if (import.meta.main) {
  const stapleOnly = process.argv[2] === "--staple";
  const app = process.argv.at(-1);
  if (!app?.endsWith(".app")) throw new Error("Usage: sign-macos-app.ts [--staple] <Mirador.app>");
  if (stapleOnly) staple(app);
  else signAndNotarize(app);
}
