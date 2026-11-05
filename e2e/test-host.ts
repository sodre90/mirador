import { execFileSync, spawn, spawnSync, type ChildProcess, type SpawnOptions, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { accessSync, chmodSync, constants, cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { muteMarkerName, MUTED_LIST_FILE, mutedListAt } from "../host/notifier.ts";
import { HOST_RELAUNCH, HOST_RESTART_EXIT_CODE } from "../shared/host-relaunch.ts";
import { freePorts } from "./free-ports.ts";
import { ownersModelServer } from "./model-server.ts";
import { processTreeOf, waitForProcessesToEnd } from "./process-tree.ts";

const repoRoot = join(import.meta.dirname, "..");
const notifierDir = join(homedir(), ".config", "claude-notifier");
const claudeProjectsDir = join(homedir(), ".claude", "projects");
const TRANSCRIPT_WRITERS_GRACE_MS = 2_000;
/** As long as a host restart waits for its services to stop (SERVICES_STOP_TIMEOUT_MS in host/restart.ts). */
const HOST_PROCESSES_EXIT_TIMEOUT_MS = 5_000;

/** dash, Linux's /bin/sh, may run commands in the shell's own process group, so the busy check needs bash there. */
export const jobControlShell = process.platform === "darwin" ? "/bin/sh" : "/bin/bash";

/** What a spec's terminals and ! commands run unless it picks a shell: the developer's own shell would read their ~/.zshrc, which can stall a spec. */
export const defaultShell = "/bin/sh";

/**
 * A path for a spec's own folder, to make in its hooks: Playwright also imports spec files in a process that never runs
 * their hooks, so a folder made on import is never removed.
 */
export const scratchPath = (name: string) => join(tmpdir(), `mirador-e2e-${name}-${crypto.randomUUID().slice(0, 8)}`);

const isRunnableFile = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

export const foldersOnPath = () => (process.env.PATH ?? "").split(delimiter).filter(Boolean);

/**
 * The first of `folders` that `name` runs from: Windows finds a program with an extension from PATHEXT. That lists them
 * in capitals, while the host shows a program's path as its file has it, in small letters.
 */
export function programIn(folders: string[], name: string): string | undefined {
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").toLowerCase().split(";") : [""];
  return folders.flatMap((folder) => extensions.map((extension) => join(folder, name + extension))).find(isRunnableFile);
}

/** Where `name` runs from on PATH, as `which` says: Windows has no which. */
export function programOnPath(name: string): string {
  const program = programIn(foldersOnPath(), name);
  if (!program) throw new Error(`${name} is not on PATH`);
  return program;
}

/** A Windows host also looks programs up on the PATH the registry holds, which a spec cannot change: `name` there, or "". */
export const programOnRegistryPath = (name: string) =>
  execFileSync("bun", [join(import.meta.dirname, "windows-registry-program.ts"), name], { encoding: "utf8" }).trim();

const isWindowsBatchFile = (program: string) => process.platform === "win32" && /\.(cmd|bat)$/i.test(program);

/** Node runs a Windows .cmd, such as npm's opencode.cmd, only through cmd.exe, which splits unquoted arguments at spaces. */
export function spawnProgram(program: string, args: string[], options: SpawnOptions): ChildProcess {
  if (!isWindowsBatchFile(program)) return spawn(program, args, options);
  return spawn(`"${program}"`, args.map((arg) => `"${arg}"`), { ...options, shell: true });
}

export function spawnProgramSync(program: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) {
  if (!isWindowsBatchFile(program)) return spawnSync(program, args, options);
  return spawnSync(`"${program}"`, args.map((arg) => `"${arg}"`), { ...options, shell: true });
}

/** Where writeBunProgram puts the program named `name`: Windows runs no script without an extension, so there it is a name.cmd. */
export const bunProgramPath = (directory: string, name: string) => join(directory, process.platform === "win32" ? `${name}.cmd` : name);

/** A program named `name` in `directory` that runs `script` on Bun with `environment` set. */
export function writeBunProgram(directory: string, name: string, script: string, environment: Record<string, string> = {}) {
  mkdirSync(directory, { recursive: true });
  const program = bunProgramPath(directory, name);
  if (process.platform === "win32") {
    const settings = Object.entries(environment).map(([variable, value]) => `@set "${variable}=${value}"\r\n`);
    writeFileSync(program, `${settings.join("")}@bun "${script}" %*\r\n`);
    return;
  }
  const settings = Object.entries(environment).map(([variable, value]) => `${variable}='${value}' `);
  writeFileSync(program, `#!/bin/sh\n${settings.join("")}exec bun '${script}' "$@"\n`);
  chmodSync(program, 0o755);
}

/**
 * The program `name`.exe in `directory`: `script` compiled by Bun, with `environment` built in. Claude Code's SDK starts no
 * .cmd on Windows (vcs-pgm.35), so a program standing in for Claude Code there is compiled.
 */
export function writeCompiledBunProgram(directory: string, name: string, script: string, environment: Record<string, string>) {
  mkdirSync(directory, { recursive: true });
  const program = join(directory, `${name}.exe`);
  const builtIn = Object.entries(environment).flatMap(([variable, value]) => ["--define", `process.env.${variable}=${JSON.stringify(value)}`]);
  execFileSync("bun", ["build", "--compile", script, "--outfile", program, ...builtIn]);
  return program;
}

/** Windows names it Path; a second key named PATH beside it would leave which one the host gets to chance. */
const pathVariableOf = (environment: NodeJS.ProcessEnv) => Object.keys(environment).find((name) => name.toUpperCase() === "PATH") ?? "PATH";

/** Set by some of the owner's profiles, so an agent on one hands it to the specs it runs, where Claude Code then offers no background Bash. */
const OWNERS_AGENT_SETTINGS = ["CLAUDE_CODE_DISABLE_BACKGROUND_TASKS"];

const withoutOwnersSettings = (environment: NodeJS.ProcessEnv) =>
  Object.fromEntries(Object.entries(environment).filter(([variable]) => !variable.startsWith("MIRADOR_P2P_") && !OWNERS_AGENT_SETTINGS.includes(variable)));

/** A host environment whose PATH is just `folders`, under the name the system gives PATH. */
export const pathOf = (folders: string[]) => ({ [pathVariableOf(process.env)]: folders.join(delimiter) });

const withFirstOnPath = (environment: NodeJS.ProcessEnv, directory: string) => {
  const pathVariable = pathVariableOf(environment);
  return { [pathVariable]: [directory, environment[pathVariable]].filter(Boolean).join(delimiter) };
};

interface TestHostOptions {
  /** Test hosts share the user's home directory, so only a host that opts in runs statusline commands from Claude settings; its spec points a profile at settings of its own. */
  runsUserStatusLine?: boolean;
  shell?: string;
  copiesSource?: boolean;
  fakePrograms?: boolean;
  /** Given the host's port when it depends on it, such as an address that leads to the host. */
  environment?: Record<string, string> | ((port: number) => Record<string, string>);
  /** Starts with no profile, as a first run does; otherwise the host has the profile a user sets up first. */
  withoutProfiles?: boolean;
  /**
   * Runs Claude Code on the owner's own login and `~/.claude`, for an opt-in run about Claude itself: real turns, or
   * screenshots of its model picker. Other hosts' Claude Code talks to the owner's model server and keeps its settings
   * and sessions in the host's `claudeConfigDir`.
   */
  usesClaudeLogin?: boolean;
}

/** The host's own port, the canvas assets port after it, and the two after those, on which it serves the network. */
const PORTS_PER_HOST = 4;
/** Another host, of this run or another, may take a port between the look for free ones and this host's start. */
const PORT_ATTEMPTS = 3;
const PORT_TAKEN = /EADDRINUSE|Is port \d+ in use/;

const timesRunningIn = (log: string) => log.split("Mirador is running").length - 1;

/** A process a signal ended has no exit code; on Windows every kill is one, as it ends the process outright. */
const hasEnded = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

/** Runs the real host (and through it a real Claude Code on a cheap model) in throwaway directories. */
export class TestHost {
  /** Only a path until start(): Playwright also imports spec files in a process that never runs their hooks. */
  readonly root = join(tmpdir(), `mirador-e2e-${crypto.randomUUID().slice(0, 8)}`);
  readonly dataDir = join(this.root, "data");
  readonly projectDir = join(this.root, "project");
  readonly claudeConfigDir = join(this.root, "claude-config");
  /**
   * The project directory as a terminal of the user's own is in it: under its long name, where a Windows runner's TEMP has
   * an 8.3 short one. Claude Code files a session under the spelling it started in, but looks sessions up under the long one.
   */
  get projectDirInTerminal() {
    return realpathSync.native(this.projectDir);
  }
  /** With the fakePrograms option, programs here come first on the host's PATH (stand-ins for gh, idea, …). */
  readonly fakeProgramsDir = join(this.root, "fake-programs");
  /** Where the host runs from: the repository, or a copy of its source that the spec may edit. */
  readonly sourceDir: string;
  private starts = 0;
  private logFile?: import("node:fs").WriteStream;
  private readonly mutedBySpec = new Set<string>();
  private firstPort?: number;
  private readonly options: TestHostOptions;
  authUrl = "";
  private process?: ChildProcess;
  private output = "";
  private startedAgain?: Promise<void>;
  private stopRequested = false;

  /** A port number first is what specs gave before hosts took free ports themselves; it is not used. */
  constructor(optionsOrUnusedPort: TestHostOptions | number = {}, options: TestHostOptions = {}) {
    this.options = typeof optionsOrUnusedPort === "number" ? options : optionsOrUnusedPort;
    this.sourceDir = this.options.copiesSource ? join(this.root, "source") : repoRoot;
  }

  /** The host's own port, which it has from its first start on: start() takes ports nothing else listens on. */
  get port() {
    if (this.firstPort === undefined) throw new Error("A test host has no port until it starts: read it in a hook or a test, not as the spec loads.");
    return this.firstPort;
  }

  get origin() {
    return `http://127.0.0.1:${this.port}`;
  }

  get pid() {
    return this.process?.pid;
  }

  /** start() does it too; a spec calls it first to prepare the copy, making it a git checkout for one. */
  copySource() {
    if (existsSync(this.sourceDir)) return;
    ["host", "shared", "web", "plugins"].forEach((directory) => cpSync(join(repoRoot, directory), join(this.sourceDir, directory), { recursive: true }));
    ["package.json", "tsconfig.json", "bun.lock"].forEach((file) => cpSync(join(repoRoot, file), join(this.sourceDir, file)));
    symlinkSync(join(repoRoot, "node_modules"), join(this.sourceDir, "node_modules"));
  }

  /** A fresh token per start, like production, so resume must re-supply it to the agent. */
  get mcpToken() {
    return `e2e-mcp-token-${this.starts}`;
  }

  /** Written by the host on its first start and kept, like the browser token. */
  get scriptToken() {
    return readFileSync(join(this.dataDir, "script-token"), "utf8").trim();
  }

  /** Runs Mirador's command line, as `mirador <args>` would on this host's machine, and gives what it printed. */
  mirador(...args: string[]) {
    return execFileSync("bun", ["host/cli.ts", ...args], {
      cwd: this.sourceDir,
      encoding: "utf8",
      env: { ...process.env, MIRADOR_PORT: String(this.port), MIRADOR_DATA_DIR: this.dataDir },
    });
  }

  private get bun() {
    return process.env.MIRADOR_E2E_MINIMAL_ENV ? programOnPath("bun") : "bun";
  }

  /**
   * MIRADOR_E2E_MINIMAL_ENV=1 starts the host like a bare terminal would: no inherited agent or shell variables. The
   * owner's own peer-to-peer settings never reach it, nor the agent settings of the profile running the specs: a spec
   * that wants a tunnel sets its own.
   */
  private baseEnvironment(): NodeJS.ProcessEnv {
    if (!process.env.MIRADOR_E2E_MINIMAL_ENV) return withoutOwnersSettings(process.env);
    const bunDir = dirname(programOnPath("bun"));
    return {
      HOME: homedir(),
      USER: process.env.USER,
      TMPDIR: process.env.TMPDIR,
      LANG: "en_US.UTF-8",
      PATH: [bunDir, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":"),
    };
  }

  async start() {
    if (!existsSync(this.projectDir)) {
      mkdirSync(this.projectDir, { recursive: true });
      writeFileSync(join(this.projectDir, "README.md"), "# e2e project\n");
    }
    if (!existsSync(this.claudeConfigDir)) {
      mkdirSync(this.claudeConfigDir, { recursive: true });
    }
    if (this.options.copiesSource) this.copySource();
    if (this.starts === 0 && !this.options.withoutProfiles) {
      mkdirSync(this.dataDir, { recursive: true });
      execFileSync(this.bun, [join(repoRoot, "e2e", "seed-profile.ts"), this.sourceDir, join(this.dataDir, "state.sqlite")]);
    }
    if (this.firstPort !== undefined) return this.launch(this.firstPort);
    for (let attempt = 1; ; attempt++) {
      const port = await freePorts(PORTS_PER_HOST);
      try {
        await this.launch(port);
        this.firstPort = port;
        return;
      } catch (error) {
        if (attempt === PORT_ATTEMPTS || !PORT_TAKEN.test(this.output)) throw error;
      }
    }
  }

  private async launch(port: number) {
    this.starts += 1;
    this.output = "";
    this.stopRequested = false;
    await this.run(port, this.environmentFor(port));
  }

  private environmentFor(port: number): NodeJS.ProcessEnv {
    const specsOwn = typeof this.options.environment === "function" ? this.options.environment(port) : this.options.environment;
    return {
      ...this.baseEnvironment(),
      ...(!this.options.usesClaudeLogin && !specsOwn?.ANTHROPIC_BASE_URL && ownersModelServer()),
      ...(!this.options.usesClaudeLogin && { CLAUDE_CONFIG_DIR: this.claudeConfigDir }),
      MIRADOR_PORT: String(port),
      MIRADOR_DATA_DIR: this.dataDir,
      MIRADOR_MCP_TOKEN: this.mcpToken,
      MIRADOR_TEST_MODEL: process.env.MIRADOR_TEST_MODEL ?? "haiku",
      MIRADOR_TEST_EFFORT: process.env.MIRADOR_TEST_EFFORT ?? "low",
      MIRADOR_TEST_SKIP_USER_SETTINGS: "1",
      MIRADOR_TAILSCALE: join(this.root, "no-tailscale-on-this-machine"),
      MIRADOR_STATUSLINE: this.options.runsUserStatusLine ? "on" : "off",
      MIRADOR_NEWER_VERSION_CHECK: "off",
      MIRADOR_PLUGIN_UPDATE_CHECK: "off",
      MIRADOR_PLUGIN_CATALOG: "off",
      MIRADOR_DEFAULT_PLUGINS: "off",
      SHELL: this.options.shell ?? defaultShell,
      ...(process.platform === "win32" && { [HOST_RELAUNCH.restartExitCode]: String(HOST_RESTART_EXIT_CODE) }),
      ...(this.options.fakePrograms && withFirstOnPath(this.baseEnvironment(), this.fakeProgramsDir)),
      ...specsOwn,
    };
  }

  /** Runs the host until it says it is running once more than this test host's log already has it. */
  private async run(port: number, env: NodeJS.ProcessEnv) {
    const timesRunningBefore = timesRunningIn(this.output);
    const child = spawn(this.bun, ["host/main.ts"], { cwd: this.sourceDir, env, stdio: ["ignore", "pipe", "pipe"] });
    this.process = child;
    const log = createWriteStream(join(this.root, "host.log"), { flags: "a" });
    this.logFile = log;
    const capture = (chunk: Buffer) => {
      this.output += chunk;
      // Output can still come after "exit", which ended the log: waiting for "close" instead would wait on any process
      // still holding the host's pipes, keeping the log open where Windows then can't remove it.
      if (log.writable) log.write(chunk);
    };
    child.stdout!.on("data", capture);
    child.stderr!.on("data", capture);
    child.once("exit", (code, signal) => {
      log.end(`\n[host exited: ${code ?? signal}]\n`);
      if (code === HOST_RESTART_EXIT_CODE && this.process === child && !this.stopRequested) this.startedAgain = this.startAgain(port, env);
    });
    const deadline = Date.now() + 15_000;
    while (timesRunningIn(this.output) === timesRunningBefore) {
      if (Date.now() > deadline || hasEnded(child)) throw new Error(`host did not start:\n${this.output}\n[files in its data folder: ${this.dataFolderFiles()}]`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.authUrl = `http://127.0.0.1:${port}/auth?token=${readFileSync(join(this.dataDir, "browser-token"), "utf8").trim()}`;
  }

  /** What the host made in its data folder, by name only: how far a host that hung got. */
  private dataFolderFiles() {
    return existsSync(this.dataDir) ? readdirSync(this.dataDir, { recursive: true }).join(", ") || "none" : "no data folder";
  }

  /**
   * Windows has no re-execution, so a host restarting there exits with the code it was given, and the test host starts
   * it again with the same environment, as the desktop app does.
   */
  private startAgain(port: number, env: NodeJS.ProcessEnv) {
    return this.run(port, env).catch(() => {
      this.output += "\n[test host: the host did not start again]\n";
    });
  }

  /**
   * The host exits once its agents and shells have ended, or after SERVICES_STOP_TIMEOUT_MS (host/restart.ts) at the
   * latest; anything still running then is waited for here and killed, so cleanUp never removes the root under a writer.
   */
  async stop() {
    await this.startedAgain;
    this.stopRequested = true;
    const child = this.process;
    if (!child || hasEnded(child)) return;
    const hostProcesses = processTreeOf(child.pid!);
    const exited = new Promise((resolve) => child.once("exit", resolve));
    this.logFile?.write(`\n${new Date().toISOString()} [test host: sending SIGTERM]\n`);
    child.kill("SIGTERM");
    await exited;
    await waitForProcessesToEnd(hostProcesses, HOST_PROCESSES_EXIT_TIMEOUT_MS);
  }

  async restart() {
    await this.stop();
    await this.start();
  }

  /** Kills the host outright, as a crash does: nothing of a turn it was running gets written down. */
  async kill() {
    await this.startedAgain;
    this.stopRequested = true;
    const child = this.process;
    if (!child || hasEnded(child)) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await exited;
  }

  get log() {
    return this.output;
  }

  /**
   * Test sessions must be muted in the user's real claude-notifier directory; otherwise its hooks (auto-approve in yolo
   * mode, phone mirroring) act on them. This mutes a session the spec runs itself, as the host mutes its own.
   */
  muteNotifier(sessionId: string) {
    if (!existsSync(notifierDir)) return;
    writeFileSync(join(notifierDir, muteMarkerName(sessionId)), "e2e terminal session (mirador)");
    this.mutedBySpec.add(sessionId);
  }

  /** Only this host's markers: hosts beside it, of this run or another, still need theirs. */
  private unmuteOwnSessions() {
    const mutedByHost = mutedListAt(join(this.dataDir, MUTED_LIST_FILE));
    [...mutedByHost, ...this.mutedBySpec].forEach((sessionId) => rmSync(join(notifierDir, muteMarkerName(sessionId)), { force: true }));
  }

  async cleanUp() {
    this.unmuteOwnSessions();
    if (process.env.MIRADOR_E2E_KEEP) return;
    rmSync(this.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    this.removeClaudeTranscripts();
    await new Promise((resolve) => setTimeout(resolve, TRANSCRIPT_WRITERS_GRACE_MS));
    rmSync(this.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    this.removeClaudeTranscripts();
  }

  /** Claude Code processes outlive the host briefly and write a last "interrupted" entry while they stop, in `~/.claude` for a host on the owner's login. */
  private removeClaudeTranscripts() {
    this.claudeTranscriptDirs().forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  }

  /** Claude Code keeps a transcript directory per working directory; these are the test project's. */
  private claudeTranscriptDirs() {
    if (!existsSync(claudeProjectsDir)) return [];
    const rootName = basename(this.root);
    return readdirSync(claudeProjectsDir)
      .filter((name) => name.includes(rootName))
      .map((name) => join(claudeProjectsDir, name));
  }
}
