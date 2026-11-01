import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Each test runs the install script with fake downloads; a loaded machine takes longer than Bun's 5 s default.
setDefaultTimeout(15_000);

const INSTALL_SCRIPT = join(import.meta.dir, "..", "install.sh");
const LINUX_LIBRARIES = ["libgtk-3.so.0", "libwebkit2gtk-4.1.so.0", "libayatana-appindicator3.so.1", "librsvg-2.so.2"];
const REAL_TOOLS = ["curl", "tar", "gzip", "mkdir", "rm", "mv", "mktemp", "cat", "env", "chmod"];

const root = mkdtempSync(join(tmpdir(), "mirador-install-"));
const requested: string[] = [];
/** Each release file the server offers, by name, and where it is on disk. */
const assets = new Map<string, string>();
let server: ReturnType<typeof Bun.serve>;

function writeExecutable(path: string, script: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
}

function tarOf(folder: string, gzip: boolean) {
  const archive = `${folder}.tar`;
  const tar = Bun.spawnSync(["tar", gzip ? "-czf" : "-cf", archive, "-C", folder, "."]);
  if (tar.exitCode !== 0) throw new Error(tar.stderr.toString());
  return archive;
}

/** The ditto stub unpacks a tar, as the test machines may have no zip. */
function macosApp() {
  const folder = join(root, "assets", "macos");
  writeExecutable(join(folder, "Mirador.app", "Contents", "MacOS", "launcher"), "exit 0");
  return tarOf(folder, false);
}

/** Like Electrobun's installer, it puts the app under ~/.local/share; it also reads its input, which must not be the script. */
function linuxSetup(arch: string) {
  const folder = join(root, "assets", `linux-${arch}`);
  writeExecutable(
    join(folder, "installer"),
    [
      "cat >/dev/null",
      'app="$HOME/.local/share/com.sodre90.mirador/stable/app"',
      'mkdir -p "$app/bin"',
      `printf '#!/bin/sh\\n' > "$app/bin/launcher"`,
      'chmod +x "$app/bin/launcher"',
      `printf ${arch} > "$HOME/installed-arch"`,
    ].join("\n"),
  );
  return tarOf(folder, true);
}

/** install.sh is the POSIX shell installer of the macOS and Linux downloads. */
describe.skipIf(process.platform === "win32")("install.sh", () => {
  beforeAll(() => {
    writeStubs();
    assets.set("Mirador-macos-arm64.zip", macosApp());
    assets.set("Mirador-linux-x64-Setup.tar.gz", linuxSetup("x64"));
    assets.set("Mirador-linux-arm64-Setup.tar.gz", linuxSetup("arm64"));
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        const name = new URL(request.url).pathname.slice(1);
        requested.push(name);
        const asset = assets.get(name);
        return asset ? new Response(Bun.file(asset)) : new Response("Not Found", { status: 404 });
      },
    });
  });

  afterAll(() => {
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  });

  type Machine = {
    os: "Darwin" | "Linux" | "MINGW64_NT-10.0-26100";
    arch?: string;
    appleSilicon?: boolean;
    runningFrom?: string;
    libraries?: string[];
    /** The glibc getconf reports, or null when it cannot read one. */
    glibc?: string | null;
    packageManager?: "apt-get" | "dnf";
    display?: boolean;
    /** The agent on PATH, if any. */
    agent?: "claude" | "pi" | false;
    /** MIRADOR_APP_DIR, or null for the script to choose. */
    appDir?: string | null;
  };

  /** Stubs that record what the script asks of them, written once: macOS checks every new program the first time it runs. */
  function writeStubs() {
    const stub = (folder: string, name: string, script = "exit 0") => writeExecutable(join(root, folder, name), `echo "${name} $*" >> "$STUB_CALLS"\n${script}`);
    stub("stubs", "uname", 'case "$1" in -s) echo "$STUB_OS" ;; -m) echo "$STUB_ARCH" ;; esac');
    stub("stubs", "sysctl", 'echo "$STUB_APPLE_SILICON"');
    stub("stubs", "ditto", 'mkdir -p "$4" && tar -xf "$3" -C "$4"');
    stub("stubs", "xattr");
    stub("stubs", "open");
    stub("stubs", "pgrep", 'case "$3" in *"$STUB_RUNNING_FROM"*) [ -n "$STUB_RUNNING_FROM" ] && exit 0 ;; esac\nexit 1');
    stub("stubs", "ldconfig", 'for library in $STUB_LIBRARIES; do printf "\\t%s (libc6) => /usr/lib/%s\\n" "$library" "$library"; done');
    stub("stubs", "getconf", 'if [ -n "$STUB_GLIBC" ]; then echo "glibc $STUB_GLIBC"; else exit 1; fi');
    stub("stubs", "id", "echo 1000");
    stub("stubs", "sudo");
    stub("apt-get", "apt-get");
    stub("dnf", "dnf");
    stub("agent", "claude");
    stub("pi-agent", "pi");
    REAL_TOOLS.forEach((tool) => {
      mkdirSync(join(root, "tools"), { recursive: true });
      symlinkSync(Bun.which(tool)!, join(root, "tools", tool));
    });
  }

  let machines = 0;

  function machineOf({ os, arch = "arm64", appleSilicon = true, runningFrom = "", libraries = LINUX_LIBRARIES, glibc = "2.39", packageManager, display = true, agent = "claude", appDir }: Machine) {
    const folder = join(root, `machine-${++machines}`);
    const [home, temp] = ["home", "tmp"].map((name) => join(folder, name));
    const appDirectory = appDir === undefined ? join(home, "Applications") : appDir;
    [home, temp].forEach((path) => mkdirSync(path, { recursive: true }));
    const calls = join(folder, "calls.log");
    writeFileSync(calls, "");
    const path = ["stubs", ...(packageManager ? [packageManager] : []), ...(agent ? [agent === "pi" ? "pi-agent" : "agent"] : []), "tools"].map((name) => join(root, name));
    const environment = {
      PATH: path.join(":"),
      HOME: home,
      TMPDIR: temp,
      MIRADOR_DOWNLOAD_URL: `http://127.0.0.1:${server.port}`,
      STUB_CALLS: calls,
      STUB_OS: os,
      STUB_ARCH: arch,
      STUB_APPLE_SILICON: appleSilicon ? "1" : "0",
      STUB_RUNNING_FROM: runningFrom,
      STUB_LIBRARIES: libraries.join(" "),
      STUB_GLIBC: glibc ?? "",
      ...(os === "Darwin" && appDirectory && { MIRADOR_APP_DIR: appDirectory }),
      ...(display && { DISPLAY: ":0" }),
    };
    return { home, calls: () => readFileSync(calls, "utf8").trim().split("\n"), environment };
  }

  /** As people run it: piped into sh, which reads the script while it runs. Not spawnSync: the download server runs in this process. */
  async function install(machine: ReturnType<typeof machineOf>) {
    requested.length = 0;
    const run = Bun.spawn(["/bin/sh", "-c", `/bin/cat "${INSTALL_SCRIPT}" | /bin/sh`], { env: machine.environment, stdout: "pipe", stderr: "pipe" });
    const [output, errors, exitCode] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    return { exitCode, output, errors };
  }

  const callsTo = (calls: string[], program: string) => calls.filter((call) => call.startsWith(`${program} `));
  const systemHasAnAgent = ["/opt/homebrew/bin", "/usr/local/bin"].some((directory) => ["claude", "opencode", "pi"].some((program) => existsSync(join(directory, program))));

  test("on an Apple Silicon Mac it replaces the app in the folder with the latest release's, clears the quarantine and opens it", async () => {
    const machine = machineOf({ os: "Darwin" });
    const app = join(machine.home, "Applications", "Mirador.app");
    writeExecutable(join(app, "Contents", "MacOS", "left-from-the-old-version"), "exit 0");

    const result = await install(machine);

    expect(result.errors).not.toContain("Mirador was not installed");
    expect(result.exitCode).toBe(0);
    expect(requested).toEqual(["Mirador-macos-arm64.zip"]);
    expect(existsSync(join(app, "Contents", "MacOS", "launcher"))).toBe(true);
    expect(existsSync(join(app, "Contents", "MacOS", "left-from-the-old-version"))).toBe(false);
    expect(callsTo(machine.calls(), "xattr")).toEqual([`xattr -dr com.apple.quarantine ${app}`]);
    expect(callsTo(machine.calls(), "open")).toEqual([`open ${app}`]);
    expect(result.output).not.toContain("none of them is installed");
  });

  test.skipIf(existsSync("/Applications/Mirador.app"))("on a Mac it updates the app where it already is, in ~/Applications", async () => {
    const machine = machineOf({ os: "Darwin", appDir: null });
    const app = join(machine.home, "Applications", "Mirador.app");
    writeExecutable(join(app, "Contents", "MacOS", "left-from-the-old-version"), "exit 0");
    expect((await install(machine)).exitCode).toBe(0);
    expect(existsSync(join(app, "Contents", "MacOS", "launcher"))).toBe(true);
    expect(callsTo(machine.calls(), "open")).toEqual([`open ${app}`]);
  });

  test.skipIf(existsSync("/Applications/Mirador.app"))("on a Mac with no Mirador yet it installs to ~/Applications, which needs no admin rights", async () => {
    const machine = machineOf({ os: "Darwin", appDir: null });
    const app = join(machine.home, "Applications", "Mirador.app");
    const result = await install(machine);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(app, "Contents", "MacOS", "launcher"))).toBe(true);
    expect(result.output).toContain(`Installed ${app}`);
    expect(callsTo(machine.calls(), "open")).toEqual([`open ${app}`]);
  });

  test("on a Mac it asks the user to quit a Mirador running from the folder it installs to, and checks only that folder", async () => {
    const machine = machineOf({ os: "Darwin", runningFrom: "Applications/Mirador.app/Contents/MacOS/" });
    const result = await install(machine);
    expect(result.exitCode).toBe(1);
    expect(result.errors).toContain("Mirador is running from");
    expect(requested).toEqual([]);
    expect(callsTo(machine.calls(), "pgrep")).toEqual([`pgrep -f -- ${join(machine.home, "Applications", "Mirador.app", "Contents", "MacOS")}/`]);
  });

  test("an Intel Mac is pointed to running Mirador from source, even from a shell under Rosetta", async () => {
    const result = await install(machineOf({ os: "Darwin", arch: "x86_64", appleSilicon: false }));
    expect(result.exitCode).toBe(1);
    expect(result.errors).toContain("the macOS app is for Apple Silicon");
    expect(requested).toEqual([]);
  });

  test("on Linux with the libraries in place it runs the installer for this architecture, which starts the app", async () => {
    const machine = machineOf({ os: "Linux", arch: "x86_64" });
    const result = await install(machine);

    expect(result.errors).not.toContain("Mirador was not installed");
    expect(result.exitCode).toBe(0);
    expect(requested).toEqual(["Mirador-linux-x64-Setup.tar.gz"]);
    expect(readFileSync(join(machine.home, "installed-arch"), "utf8")).toBe("x64");
    expect(callsTo(machine.calls(), "sudo")).toEqual([]);
    expect(result.output).toContain("Mirador is starting.");
  });

  test("on Linux it installs missing libraries with sudo apt-get, or dnf, before the app", async () => {
    const debian = machineOf({ os: "Linux", arch: "aarch64", libraries: ["libgtk-3.so.0"], packageManager: "apt-get" });
    expect((await install(debian)).exitCode).toBe(0);
    expect(requested).toEqual(["Mirador-linux-arm64-Setup.tar.gz"]);
    expect(callsTo(debian.calls(), "sudo")).toEqual([
      "sudo env DEBIAN_FRONTEND=noninteractive apt-get update -q",
      "sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y -q libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2",
    ]);

    const fedora = machineOf({ os: "Linux", arch: "x86_64", libraries: [], packageManager: "dnf" });
    expect((await install(fedora)).exitCode).toBe(0);
    expect(callsTo(fedora.calls(), "sudo")).toEqual(["sudo dnf install -y gtk3 webkit2gtk4.1 libayatana-appindicator-gtk3 librsvg2"]);
  });

  test("on Linux without apt-get or dnf it names the missing libraries and installs nothing", async () => {
    const result = await install(machineOf({ os: "Linux", arch: "x86_64", libraries: ["libgtk-3.so.0", "librsvg-2.so.2"] }));
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Missing: libwebkit2gtk-4.1.so.0 libayatana-appindicator3.so.1");
    expect(result.errors).toContain("install them with your package manager");
    expect(requested).toEqual([]);
  });

  test("on Linux without a display it leaves starting the app to the applications menu", async () => {
    const machine = machineOf({ os: "Linux", arch: "x86_64", display: false });
    const result = await install(machine);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Start Mirador from your applications menu.");
    expect(result.output).not.toContain("Mirador is starting.");
  });

  test("on Linux with glibc 2.35 it names the glibc 2.36 requirement and downloads nothing", async () => {
    const result = await install(machineOf({ os: "Linux", arch: "x86_64", glibc: "2.35" }));
    expect(result.exitCode).toBe(1);
    expect(result.errors).toContain("glibc 2.36 or newer");
    expect(result.errors).toContain("2.35");
    expect(requested).toEqual([]);
  });

  test("on Linux with glibc 2.36 it runs the installer as today", async () => {
    const machine = machineOf({ os: "Linux", arch: "x86_64", glibc: "2.36" });
    const result = await install(machine);
    expect(result.exitCode).toBe(0);
    expect(requested).toEqual(["Mirador-linux-x64-Setup.tar.gz"]);
  });

  test("on Linux where getconf cannot read the glibc it runs the installer as today", async () => {
    const machine = machineOf({ os: "Linux", arch: "x86_64", glibc: null });
    const result = await install(machine);
    expect(result.exitCode).toBe(0);
    expect(requested).toEqual(["Mirador-linux-x64-Setup.tar.gz"]);
  });

  test("other systems and architectures are refused before downloading anything", async () => {
    const riscv = await install(machineOf({ os: "Linux", arch: "riscv64" }));
    expect(riscv.exitCode).toBe(1);
    expect(riscv.errors).toContain("built for x64 and arm64, not riscv64");
    const running = await install(machineOf({ os: "Linux", arch: "x86_64", runningFrom: "com.sodre90.mirador/stable/app/bin/" }));
    expect(running.exitCode).toBe(1);
    expect(running.errors).toContain("Mirador is running.");
    expect(requested).toEqual([]);
  });

  test("in a Windows shell such as Git Bash it points to install.ps1, before downloading anything", async () => {
    const result = await install(machineOf({ os: "MINGW64_NT-10.0-26100", arch: "x86_64" }));
    expect(result.exitCode).toBe(1);
    expect(result.errors).toContain("on Windows, run this in PowerShell instead: irm https://github.com/sodre90/mirador/releases/latest/download/install.ps1 | iex");
    expect(requested).toEqual([]);
  });

  test("a failed download stops the install with the address it tried", async () => {
    assets.delete("Mirador-macos-arm64.zip");
    try {
      const result = await install(machineOf({ os: "Darwin" }));
      expect(result.exitCode).toBe(1);
      expect(result.errors).toContain(`could not download http://127.0.0.1:${server.port}/Mirador-macos-arm64.zip`);
    } finally {
      assets.set("Mirador-macos-arm64.zip", macosApp());
    }
  });

  test("with only pi installed it says nothing about installing an agent", async () => {
    const result = await install(machineOf({ os: "Linux", arch: "x86_64", agent: "pi" }));
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toContain("none of them is installed");
  });

  test.skipIf(systemHasAnAgent)("without Claude Code, opencode or pi it says how to install Claude Code", async () => {
    const result = await install(machineOf({ os: "Linux", arch: "x86_64", agent: false }));
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("curl -fsSL https://claude.ai/install.sh | bash");
  });
});

const POWERSHELL_INSTALL_SCRIPT = join(import.meta.dir, "..", "install.ps1");

/**
 * As Electrobun's installer: it reads its payload from .installer beside it, waits for its Close button unless told to
 * close itself, then installs the app under LOCALAPPDATA and starts it. Copied in as the app's launcher, it notes each
 * start and runs for a while, with --stay for long.
 */
const FAKE_INSTALLER = `
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
public static class FakeInstaller {
  public static int Main(string[] args) {
    string self = Process.GetCurrentProcess().MainModule.FileName;
    string folder = Path.GetDirectoryName(self);
    if (Path.GetFileName(self).Equals("launcher.exe", StringComparison.OrdinalIgnoreCase)) {
      File.AppendAllText(Path.Combine(folder, "starts.log"), "started\\n");
      Thread.Sleep(args.Length > 0 && args[0] == "--stay" ? 120000 : 3000);
      return 0;
    }
    if (!File.Exists(Path.Combine(folder, ".installer", "Mirador-Setup.tar.zst"))) return 3;
    if (Environment.GetEnvironmentVariable("ELECTROBUN_INSTALLER_UI_AUTOCLOSE") != "1") Thread.Sleep(Timeout.Infinite);
    if (Environment.GetEnvironmentVariable("FAKE_INSTALLER_FAILS") == "1") return 1;
    string bin = Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA"), "com.sodre90.mirador", "stable", "app", "bin");
    Directory.CreateDirectory(bin);
    string launcher = Path.Combine(bin, "launcher.exe");
    File.Copy(self, launcher, true);
    Process.Start(new ProcessStartInfo(launcher) { UseShellExecute = false });
    return 0;
  }
}`;

const SETUP_ARCHIVE = "Mirador-windows-x64-Setup.zip";
const INSTALLER_TIMEOUT = 90_000;

function powershell(command: string) {
  const result = Bun.spawnSync(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command]);
  if (result.exitCode !== 0) throw new Error(`${command}: ${result.stderr}`);
}

/** install.ps1 is what Windows users paste into PowerShell, which runs the script as GitHub serves it. */
describe.skipIf(process.platform !== "win32")("install.ps1", () => {
  const windowsRoot = join(root, "windows");
  const fakeInstaller = join(windowsRoot, "fake-installer.exe");
  const windowsAssets = new Map<string, string>();
  const asked: string[] = [];
  let windowsServer: ReturnType<typeof Bun.serve>;
  let machines = 0;

  /** As GitHub sends release files, which Windows PowerShell's irm must still read as text. */
  const releaseFile = (path: string) => new Response(Bun.file(path), { headers: { "Content-Type": "application/octet-stream" } });

  function setupArchive() {
    const folder = join(windowsRoot, "setup");
    mkdirSync(join(folder, ".installer"), { recursive: true });
    copyFileSync(fakeInstaller, join(folder, "Mirador-Setup.exe"));
    writeFileSync(join(folder, ".installer", "Mirador-Setup.tar.zst"), "the app");
    const archive = join(windowsRoot, SETUP_ARCHIVE);
    const tar = Bun.spawnSync([join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), "-a", "-c", "-f", archive, "-C", folder, "Mirador-Setup.exe", ".installer"]);
    if (tar.exitCode !== 0) throw new Error(tar.stderr.toString());
    return archive;
  }

  beforeAll(() => {
    mkdirSync(windowsRoot, { recursive: true });
    const source = join(windowsRoot, "fake-installer.cs");
    writeFileSync(source, FAKE_INSTALLER);
    powershell(`Add-Type -TypeDefinition (Get-Content -Raw '${source}') -OutputAssembly '${fakeInstaller}' -OutputType WindowsApplication`);
    windowsAssets.set("install.ps1", POWERSHELL_INSTALL_SCRIPT);
    windowsAssets.set(SETUP_ARCHIVE, setupArchive());
    windowsServer = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        const name = new URL(request.url).pathname.slice(1);
        asked.push(name);
        const asset = windowsAssets.get(name);
        return asset ? releaseFile(asset) : new Response("Not Found", { status: 404 });
      },
    });
  }, 120_000);

  afterAll(() => {
    powershell(`Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith('${windowsRoot}\\', 'OrdinalIgnoreCase') } | Stop-Process -Force`);
    windowsServer.stop(true);
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  });

  function windowsMachine({ agent = true, failingInstaller = false, architecture = "AMD64" } = {}) {
    const folder = join(windowsRoot, `machine-${++machines}`);
    const [localAppData, temp, profile] = ["local", "temp", "profile"].map((name) => join(folder, name));
    [localAppData, temp, profile].forEach((path) => mkdirSync(path, { recursive: true }));
    if (agent) {
      mkdirSync(join(profile, ".local", "bin"), { recursive: true });
      writeFileSync(join(profile, ".local", "bin", "claude.exe"), "");
    }
    const { PROCESSOR_ARCHITEW6432: _, ...inherited } = process.env;
    const environment = {
      ...inherited,
      PROCESSOR_ARCHITECTURE: architecture,
      LOCALAPPDATA: localAppData,
      TEMP: temp,
      TMP: temp,
      USERPROFILE: profile,
      MIRADOR_DOWNLOAD_URL: `http://127.0.0.1:${windowsServer.port}`,
      ...(failingInstaller && { FAKE_INSTALLER_FAILS: "1" }),
    };
    const app = join(localAppData, "com.sodre90.mirador", "stable", "app");
    return { app, launcher: join(app, "bin", "launcher.exe"), temp, environment };
  }

  /** As people run it: fetched with irm and run by iex in the PowerShell they typed it into. */
  async function installOnWindows(machine: ReturnType<typeof windowsMachine>) {
    asked.length = 0;
    const run = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", `irm ${machine.environment.MIRADOR_DOWNLOAD_URL}/install.ps1 | iex`], {
      env: machine.environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [output, errors] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    return { output: output.replaceAll("\r\n", "\n"), errors };
  }

  const startsOf = (machine: ReturnType<typeof windowsMachine>) => readFileSync(join(machine.app, "bin", "starts.log"), "utf8").trim().split("\n");
  const setupsLeftIn = (temp: string) => readdirSync(temp).filter((name) => name.startsWith("mirador-install-"));
  const windowsHasAnAgent = ["claude", "opencode", "pi"].some((program) => Bun.which(program) !== null);

  test(
    "runs the release's installer, which closes itself once it has installed and started the app, and leaves nothing behind",
    async () => {
      const machine = windowsMachine();
      const result = await installOnWindows(machine);
      expect(result.output).toContain(`Installed Mirador in ${machine.app}`);
      expect(result.output).toContain("Mirador is starting.");
      expect(result.output).not.toContain("not installed");
      expect(asked).toEqual(["install.ps1", SETUP_ARCHIVE]);
      await Bun.sleep(4000);
      expect(startsOf(machine)).toEqual(["started"]);
      expect(setupsLeftIn(machine.temp)).toEqual([]);
    },
    INSTALLER_TIMEOUT,
  );

  test(
    "asks the user to quit a Mirador running from the app's folder, before downloading anything",
    async () => {
      const machine = windowsMachine();
      mkdirSync(dirname(machine.launcher), { recursive: true });
      copyFileSync(fakeInstaller, machine.launcher);
      const running = Bun.spawn([machine.launcher, "--stay"]);
      try {
        await Bun.sleep(500);
        const result = await installOnWindows(machine);
        expect(result.output).toContain("Mirador was not installed: Mirador is running. Quit it from its tray icon, with Run host in the background off, then run this again.");
        expect(asked).toEqual(["install.ps1"]);
      } finally {
        running.kill();
      }
    },
    INSTALLER_TIMEOUT,
  );

  test(
    "a failed installer stops the install with its exit code, and keeps it for the user to run",
    async () => {
      const machine = windowsMachine({ failingInstaller: true });
      const result = await installOnWindows(machine);
      const kept = /its installer failed \(exit code 1\)\. Run (.+Mirador-Setup\.exe) to see why\./.exec(result.output.replaceAll("\n", ""));
      expect(kept).not.toBeNull();
      expect(existsSync(kept![1]!)).toBe(true);
      expect(existsSync(machine.launcher)).toBe(false);
    },
    INSTALLER_TIMEOUT,
  );

  test(
    "a failed download stops the install with the address it tried",
    async () => {
      const archive = windowsAssets.get(SETUP_ARCHIVE)!;
      windowsAssets.delete(SETUP_ARCHIVE);
      try {
        const machine = windowsMachine();
        const result = await installOnWindows(machine);
        expect(result.output).toContain(`Mirador was not installed: could not download ${machine.environment.MIRADOR_DOWNLOAD_URL}/${SETUP_ARCHIVE}`);
        expect(setupsLeftIn(machine.temp)).toEqual([]);
      } finally {
        windowsAssets.set(SETUP_ARCHIVE, archive);
      }
    },
    INSTALLER_TIMEOUT,
  );

  test(
    "a Windows on Arm machine is refused before downloading anything",
    async () => {
      const result = await installOnWindows(windowsMachine({ architecture: "ARM64" }));
      expect(result.output).toContain("Mirador was not installed: Mirador's Windows app is built for x64, not ARM64.");
      expect(asked).toEqual(["install.ps1"]);
    },
    INSTALLER_TIMEOUT,
  );

  test.skipIf(windowsHasAnAgent)(
    "without Claude Code, opencode or pi it says how to install Claude Code",
    async () => {
      const result = await installOnWindows(windowsMachine({ agent: false }));
      expect(result.output).toContain("Mirador is starting.");
      expect(result.output).toContain("irm https://claude.ai/install.ps1 | iex");
    },
    INSTALLER_TIMEOUT,
  );
});
