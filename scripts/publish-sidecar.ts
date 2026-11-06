#!/usr/bin/env bun
/**
 * Builds the peer-to-peer sidecar from a commit of the private mirador-p2p, publishes it as a prerelease of the public
 * repository for hosts to download the first time they need it, and pins that release and its SHA-256s in
 * host/p2p/sidecar-download.ts. The macOS one is built and signed with the Developer ID here; the Linux ones are built
 * on LINUX_HOST in Ubuntu 22.04 and must run on Ubuntu 22.04 and Debian 12 before anything is published. The Windows one is
 * cross-built here with cargo-xwin, which needs Homebrew's llvm and lld (for clang-cl, as ring compiles C).
 * Usage: LINUX_HOST=user@host bun scripts/publish-sidecar.ts [commit]  (P2P_SOURCE: the mirador-p2p clone, ~/prj/mirador-p2p)
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { RELEASES_REPOSITORY } from "../shared/newer-version.ts";

const SIGNING_IDENTITY = "Developer ID Application";
const PINS = join(import.meta.dir, "..", "host", "p2p", "sidecar-download.ts");
const LINUX_BUILDS = [
  { platformAndCpu: "linux-x64", container: "linux/amd64" },
  { platformAndCpu: "linux-arm64", container: "linux/arm64" },
];
/** Distributions the Linux desktop app runs on, oldest C library first; the sidecar has to start on each. */
const LINUX_CHECKS = ["docker.io/library/ubuntu:22.04", "docker.io/library/debian:12"];
const RUST_VERSION = "1.99.1";
const WINDOWS_TARGET = "x86_64-pc-windows-msvc";
const WINDOWS_TOOLS = ["/opt/homebrew/opt/llvm/bin", "/opt/homebrew/opt/lld/bin"];

function run(command: string[], cwd?: string, input?: Uint8Array, env?: Record<string, string>) {
  const result = Bun.spawnSync(command, { cwd, env: env && { ...process.env, ...env }, stdin: input ?? "inherit", stdout: "pipe", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${command.join(" ")} failed with exit code ${result.exitCode}`);
  return result.stdout;
}
const text = (command: string[], cwd?: string) => run(command, cwd).toString().trim();

const source = process.env.P2P_SOURCE ?? join(homedir(), "prj", "mirador-p2p");
const linuxHost = process.env.LINUX_HOST;
if (!linuxHost) throw new Error("Name the x64 Linux machine that builds the Linux sidecars: LINUX_HOST=user@host");
const commit = text(["git", "rev-parse", "--verify", `${process.argv[2] ?? "origin/main"}^{commit}`], source);
const tag = `p2p-sidecar-${commit.slice(0, 7)}`;
const archive = run(["git", "archive", "--format=tar", commit], source);
const out = mkdtempSync(join(tmpdir(), "mirador-sidecar-"));
const asset = (platformAndCpu: string) => join(out, `mirador-p2p-${platformAndCpu}${platformAndCpu.startsWith("win32") ? ".exe" : ""}`);
console.error(`Building ${tag} from ${commit} in ${out}`);

function buildForMacos() {
  const tree = join(out, "macos-source");
  run(["mkdir", "-p", tree]);
  run(["tar", "-xf", "-"], tree, archive);
  run(["cargo", "build", "-q", "--release", "--locked", "-p", "mirador-p2p"], tree);
  run(["cp", join(tree, "target", "release", "mirador-p2p"), asset("darwin-arm64")]);
  run(["codesign", "--force", "--options", "runtime", "--timestamp", "--sign", SIGNING_IDENTITY, asset("darwin-arm64")]);
  run(["codesign", "--verify", "--strict", asset("darwin-arm64")]);
  run([asset("darwin-arm64"), "--help"]);
  rmSync(tree, { recursive: true, force: true });
}

function buildForWindows() {
  const tree = join(out, "windows-source");
  run(["mkdir", "-p", tree]);
  run(["tar", "-xf", "-"], tree, archive);
  run(["cargo", "xwin", "build", "-q", "--release", "--locked", "-p", "mirador-p2p", "--target", WINDOWS_TARGET], tree, undefined, { PATH: [...WINDOWS_TOOLS, process.env.PATH].join(":") });
  run(["cp", join(tree, "target", WINDOWS_TARGET, "release", "mirador-p2p.exe"), asset("win32-x64")]);
  rmSync(tree, { recursive: true, force: true });
}

/** Builds in Ubuntu 22.04 on the Linux machine, the source in on stdin and the binary back on stdout, so nothing is left there. */
function buildForLinux({ platformAndCpu, container }: (typeof LINUX_BUILDS)[number]) {
  const script = [
    "set -e",
    "mkdir /build && cd /build && tar -xf -",
    "apt-get update -qq </dev/null && apt-get install -y -qq --no-install-recommends ca-certificates curl build-essential pkg-config </dev/null >/dev/null",
    "curl -fsSL https://sh.rustup.rs -o /tmp/rustup.sh",
    `sh /tmp/rustup.sh -y -q --profile minimal --default-toolchain ${RUST_VERSION} </dev/null >/dev/null`,
    "$HOME/.cargo/bin/cargo build -q --release --locked -p mirador-p2p >&2",
    "cat target/release/mirador-p2p",
  ].join("; ");
  const name = `mirador-sidecar-build-${platformAndCpu}`;
  const binary = run(["ssh", linuxHost!, `docker run --rm -i --name ${name} --platform ${container} docker.io/library/ubuntu:22.04 bash -c '${script}'`], undefined, archive);
  writeFileSync(asset(platformAndCpu), binary, { mode: 0o755 });
}

/** Runs it on each distribution in LINUX_CHECKS, from a scratch file removed afterwards. */
function checkRunsOnLinux({ platformAndCpu, container }: (typeof LINUX_BUILDS)[number]) {
  const scratch = `/tmp/mirador-sidecar-check-${platformAndCpu}`;
  run(["ssh", linuxHost!, `cat > ${scratch} && chmod 755 ${scratch}`], undefined, readFileSync(asset(platformAndCpu)));
  try {
    for (const image of LINUX_CHECKS) {
      run(["ssh", linuxHost!, `docker run --rm --platform ${container} -v ${scratch}:/sidecar:ro ${image} /sidecar --help >/dev/null`]);
      console.error(`${platformAndCpu} runs on ${image}`);
    }
  } finally {
    run(["ssh", linuxHost!, `rm -f ${scratch}`]);
  }
}

const sha256Of = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

function pin(sha256s: Record<string, string>) {
  const pins = Object.entries(sha256s)
    .map(([platformAndCpu, sha256]) => `  "${platformAndCpu}": "${sha256}",`)
    .join("\n");
  const code = readFileSync(PINS, "utf8")
    .replace(/export const SIDECAR_RELEASE = ".*";/, `export const SIDECAR_RELEASE = "${tag}";`)
    .replace(/export const SIDECAR_SHA256: Partial<Record<string, string>> = \{[^}]*\};/, `export const SIDECAR_SHA256: Partial<Record<string, string>> = {\n${pins}\n};`);
  writeFileSync(PINS, code);
}

try {
  buildForMacos();
  buildForWindows();
  LINUX_BUILDS.forEach((build) => {
    buildForLinux(build);
    checkRunsOnLinux(build);
  });
  const sha256s = Object.fromEntries(["darwin-arm64", "win32-x64", ...LINUX_BUILDS.map(({ platformAndCpu }) => platformAndCpu)].map((platformAndCpu) => [platformAndCpu, sha256Of(asset(platformAndCpu))]));
  const sums = Object.entries(sha256s).map(([platformAndCpu, sha256]) => `${sha256}  ${basename(asset(platformAndCpu))}`);
  writeFileSync(join(out, "SHA256SUMS"), `${sums.join("\n")}\n`);
  const notes = `The peer-to-peer sidecar Mirador downloads the first time it needs one, built from mirador-p2p ${commit}. Not a Mirador release.`;
  // A prerelease, never the latest, so nothing that looks for Mirador's newest release or its update files finds it.
  run(["gh", "release", "create", tag, "--repo", RELEASES_REPOSITORY, "--prerelease", "--latest=false", "--title", `Peer-to-peer sidecar ${commit.slice(0, 7)}`, "--notes", notes, ...Object.keys(sha256s).map(asset), join(out, "SHA256SUMS")]);
  pin(sha256s);
  console.error(`Published ${tag} and pinned it in ${PINS}`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
