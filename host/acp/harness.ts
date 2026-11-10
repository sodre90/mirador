import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, closeSync, createWriteStream, mkdirSync, openSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { HostProblemError, type AgentGone, type PrelaunchFailure } from "../../shared/host-problems.ts";
import type { HarnessId } from "../../shared/model.ts";
import { MIRADOR_VERSION } from "../../shared/version.ts";
import { asyncTaskUpdateOf } from "../async-tasks.ts";
import { commandLine, commandShell, withOutputAppendedTo } from "../command-shell.ts";
import { killProcessTree } from "../windows-processes.ts";
import { timestampedLines } from "../timestamped-lines.ts";

export type ConfigValue = string | boolean;

const PRELAUNCH_TIMEOUT_MS = 60_000;
const INITIALIZE_TIMEOUT_MS = 60_000;
const PRELAUNCH_OUTPUT_IN_ERRORS = 600;
const FORCE_KILL_GRACE_MS = 3000;
/** A connection closes just before its process exits; a stop that has to SIGKILL the agent takes the grace period. */
const EXIT_WAIT_MS = FORCE_KILL_GRACE_MS + 2000;
/**
 * The connection does not wait any longer for the end of an exited agent's output: a child it started can hold the
 * output open, and Bun on Windows sometimes never reports its end, which would leave the turn running for good.
 */
const LAST_OUTPUT_AFTER_EXIT_MS = 1000;
/** claude-agent-acp's extension for adding a message to the running turn, advertised in `_meta.steering` at initialize. */
const STEERING_METHOD = "_session/steering";
/** claude-agent-acp's extension for stopping one of Claude Code's background tasks, answering `stopped: false` when it has none by that id. */
const ASYNC_TASK_STOP_METHOD = "_session/async_task/stop";
/**
 * The background task's session update as this client's own method. The SDK parses every `session/update` against
 * its schema's union of known updates before handlers see it, and its router throws on one whose tag is unknown, so
 * a background task's update never reaches a handler registered on `session/update`; those ride on this method.
 */
const ASYNC_TASK_UPDATE_METHOD = "_session/async_task/update";

const sessionUpdateOf = (message: acp.AnyMessage): unknown =>
  "method" in message && message.method === acp.methods.client.session.update
    ? (message.params as { update?: unknown }).update
    : undefined;

/** The agent's background task updates on their own method, every other message as it came. */
function routeAsyncTaskUpdates(stream: acp.Stream): acp.Stream {
  return {
    writable: stream.writable,
    readable: stream.readable.pipeThrough(
      new TransformStream<acp.AnyMessage, acp.AnyMessage>({
        transform(message, controller) {
          const update = sessionUpdateOf(message);
          const carried = typeof update === "object" && update !== null ? asyncTaskUpdateOf(update) : null;
          controller.enqueue(carried ? ({ ...message, method: ASYNC_TASK_UPDATE_METHOD } as acp.AnyMessage) : message);
        },
      }),
    ),
  };
}

const latestStartByHarness = new Map<HarnessId, Promise<unknown>>();

/** Windows runs a .cmd or .bat, such as the opencode.cmd npm installs, only through cmd.exe, and refuses to spawn it otherwise. */
const isWindowsBatchFile = (program: string) => process.platform === "win32" && /\.(cmd|bat)$/i.test(program);

/** The agent's arguments are the host's own, such as `acp`, so only the program's path, which may hold spaces, needs quoting for cmd.exe. */
const spawnAgent = (program: string, args: string[], environment: Record<string, string>): ChildProcess =>
  isWindowsBatchFile(program)
    ? spawn(`"${program}"`, args, { stdio: ["pipe", "pipe", "pipe"], env: environment, shell: true })
    : spawn(program, args, { stdio: ["pipe", "pipe", "pipe"], env: environment });

/**
 * codex-acp sends an AIR client a command's output only to one that takes Zed's `terminal_output` chunks, which pi-acp
 * sends anyway. opencode knows the key too, so the others are left as they were.
 */
const commandOutputCapability = (harness: HarnessId) => (harness === "codex" ? { terminal_output: true } : {});

/** Codex asks its questions as forms, which Mirador shows as canvas questions. Claude Code reads the capability too, so it alone hears of it. */
const formQuestionsCapability = (harness: HarnessId): Pick<acp.ClientCapabilities, "elicitation"> => (harness === "codex" ? { elicitation: { form: {} } } : {});

export interface HarnessSpec {
  id: HarnessId;
  /** Names the agent process in messages, e.g. "Claude Code (work)". */
  label: string;
  logName: string;
  command: string[];
  environment: Record<string, string>;
  /** Shell command run before the agent starts, e.g. to bring up a local proxy. */
  prelaunch: string;
  /** Two opencode processes starting at the same moment fail with "database is locked". */
  startsOneAtATime: boolean;
}

export interface HarnessListener {
  onSessionUpdate(notification: acp.SessionNotification): void;
  onPermissionRequest(request: acp.RequestPermissionRequest, signal: AbortSignal): Promise<acp.RequestPermissionResponse>;
  onElicitationRequest(request: acp.CreateElicitationRequest, signal: AbortSignal): Promise<acp.CreateElicitationResponse>;
  onExit(harness: HarnessProcess, gone: AgentGone): void;
}

export class HarnessProcess {
  private child?: ChildProcess;
  /** Settles with why the agent process went away, e.g. it exited with 1. */
  private exited: Promise<AgentGone> = Promise.resolve({ kind: "not-running" });
  private connection?: acp.ClientConnection;
  private initialized?: Promise<acp.InitializeResponse>;
  private stopReason?: AgentGone;
  /** Counts the starts, so the process of an earlier one that goes away late leaves a later one be. */
  private startsSoFar = 0;
  private prelaunchProcess?: ChildProcess;

  constructor(
    readonly spec: HarnessSpec,
    private readonly listener: HarnessListener,
    private readonly logDir: string,
    private readonly initializeTimeoutMs = INITIALIZE_TIMEOUT_MS,
  ) {}

  start(): Promise<acp.InitializeResponse> {
    if (!this.initialized) {
      this.stopReason = undefined;
      this.startsSoFar += 1;
      this.initialized = this.launchInTurn().catch((error) => {
        this.initialized = undefined;
        throw error;
      });
    }
    return this.initialized;
  }

  async newSession(request: acp.NewSessionRequest) {
    return this.failingWithExitReason((agent) => agent.request(acp.methods.agent.session.new, request));
  }

  async resumeSession(request: acp.ResumeSessionRequest) {
    return this.failingWithExitReason((agent) => agent.request(acp.methods.agent.session.resume, request));
  }

  async loadSession(request: acp.LoadSessionRequest) {
    return this.failingWithExitReason((agent) => agent.request(acp.methods.agent.session.load, request));
  }

  async forkSession(request: acp.ForkSessionRequest) {
    return this.failingWithExitReason((agent) => agent.request(acp.methods.agent.session.fork, request));
  }

  /** Lets go of a session so another agent process can take it over; a process that is not running holds none. */
  async closeSession(sessionId: string) {
    const capabilities = await this.initialized;
    if (!capabilities?.agentCapabilities?.sessionCapabilities?.close) return;
    await this.failingWithExitReason((agent) => agent.request(acp.methods.agent.session.close, { sessionId }));
  }

  /** What lets a session be let go of and picked up again later: closing it, and resuming or loading it. */
  async reopening() {
    const capabilities = (await this.initialized)?.agentCapabilities;
    return { close: Boolean(capabilities?.sessionCapabilities?.close), resume: Boolean(capabilities?.sessionCapabilities?.resume), load: Boolean(capabilities?.loadSession) };
  }

  async listSessions(cwd: string) {
    return this.agent().request(acp.methods.agent.session.list, { cwd });
  }

  async prompt(sessionId: string, prompt: acp.ContentBlock[]) {
    return this.failingWithExitReason((agent) => agent.request(acp.methods.agent.session.prompt, { sessionId, prompt }));
  }

  /**
   * Adds the message to the turn running in the session rather than starting a turn after it, and returns the agent's
   * outcome. Any other than "injected", such as "promptRequired" once the turn has ended, leaves the message the
   * caller's to send.
   */
  async steer(sessionId: string, prompt: acp.ContentBlock[]): Promise<string> {
    if (!(await this.canSteer())) return "unsupported";
    const { outcome } = await this.agent().request<{ outcome: string }>(STEERING_METHOD, {
      sessionId,
      prompt,
      _meta: { steering: { idleBehavior: "promptRequired" } },
    });
    return outcome;
  }

  async canSteer() {
    const capabilities = await this.initialized;
    return (capabilities?._meta?.steering as { supported?: unknown } | undefined)?.supported === true;
  }

  /**
   * Stops one of Claude Code's background tasks, leaving the turn that started it running. False when the agent has no
   * task by that id it can stop, e.g. one that ended already.
   */
  async stopAsyncTask(sessionId: string, asyncTaskId: string): Promise<boolean> {
    const { stopped } = await this.failingWithExitReason((agent) =>
      agent.request<{ stopped: unknown }>(ASYNC_TASK_STOP_METHOD, { sessionId, asyncTaskId }),
    );
    return stopped === true;
  }

  async cancel(sessionId: string) {
    await this.agent().notify(acp.methods.agent.session.cancel, { sessionId });
  }

  async setConfigOption(sessionId: string, configId: string, value: ConfigValue) {
    const request: acp.SetSessionConfigOptionRequest =
      typeof value === "boolean" ? { sessionId, configId, type: "boolean", value } : { sessionId, configId, value };
    return this.failingWithExitReason((agent) => agent.request(acp.methods.agent.session.setConfigOption, request));
  }

  /**
   * Settles once the agent process has exited. An agent that handles the stop signal can defer it as long as it
   * likes — claude-agent-acp disposes itself on SIGTERM, which wedges when the turn is wedged — so the grace
   * period ends with SIGKILL; a connection left closed and uncleaned would fail every later prompt of its own kind.
   * Windows has no stop signal, so there the agent cannot end what it started: it is killed at once with all of it.
   * Either way the agent process went away because it was stopped, not with the exit code or signal that ended it.
   * A pre-launch command still running ends the way its timeout ends it, the shell alone, so a proxy it started in the
   * background stays up for the next start.
   */
  async stop(reason: AgentGone = { kind: "stopped" }): Promise<AgentGone> {
    this.stopReason = reason;
    this.prelaunchProcess?.kill();
    const child = this.child;
    this.connection?.close();
    if (process.platform === "win32" && child?.pid !== undefined) void killProcessTree(child.pid);
    else if (child) {
      child.kill();
      setTimeout(() => child.exitCode === null && child.signalCode === null && child.kill("SIGKILL"), FORCE_KILL_GRACE_MS).unref();
    }
    // A start still waiting its turn or running the pre-launch command has no process to wait for; settles once its
    // launch has ended and let go of `initialized`, so the next start begins afresh rather than join this one.
    if (this.initialized && !this.child) await this.initialized.catch(() => {});
    return this.exited;
  }

  private agent() {
    if (!this.connection) throw new HostProblemError({ code: "agent-not-running", agent: this.spec.label });
    return this.connection.agent;
  }

  /**
   * A request the agent process goes away during fails with why it went away, rather than with the closed connection,
   * and only once the process has exited, so by then the process is known to be gone.
   */
  private async failingWithExitReason<T>(request: (agent: acp.ClientConnection["agent"]) => Promise<T>): Promise<T> {
    const { connection, exited } = this;
    try {
      return await request(this.agent());
    } catch (error) {
      if (!connection?.signal.aborted) throw error;
      const reason = await Promise.race([exited, Bun.sleep(EXIT_WAIT_MS).then(() => null)]);
      throw reason === null ? error : new HostProblemError({ code: "agent-gone", agent: this.spec.label, gone: reason });
    }
  }

  private launchInTurn() {
    if (!this.spec.startsOneAtATime) return this.launch();
    const previous = latestStartByHarness.get(this.spec.id) ?? Promise.resolve();
    const launched = previous.catch(() => {}).then(() => this.launch());
    latestStartByHarness.set(this.spec.id, launched);
    return launched;
  }

  private async launch() {
    const ownStart = this.startsSoFar;
    this.endIfStoppedBeforeSpawning(ownStart);
    await this.runPrelaunch();
    this.endIfStoppedBeforeSpawning(ownStart);
    const [command, ...args] = this.spec.command;
    const child = spawnAgent(command!, args, this.spec.environment);
    this.child = child;
    let exitedBecause = (_reason: AgentGone) => {};
    this.exited = new Promise((resolve) => (exitedBecause = resolve));
    let gone = false;
    const goneBecause = (reason: AgentGone) => {
      if (gone) return;
      gone = true;
      if (this.startsSoFar === ownStart) {
        this.connection = undefined;
        this.initialized = undefined;
        this.child = undefined;
        this.stopReason = undefined;
        this.listener.onExit(this, reason);
      }
      exitedBecause(reason);
    };
    child.on("error", (error) => child.pid === undefined && goneBecause({ kind: "could-not-start", cause: error.message }));
    const log = createWriteStream(this.logPath(), { flags: "a" });
    const stamped = timestampedLines();
    log.on("error", (error) => {
      console.error(`could not write the ${this.spec.label} agent's log:`, error.message);
      child.stderr!.unpipe(stamped);
      child.stderr!.resume();
    });
    child.stderr!.pipe(stamped).pipe(log);
    const stream = routeAsyncTaskUpdates(
      acp.ndJsonStream(
        Writable.toWeb(child.stdin!),
        Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
      ),
    );
    const connection = acp
      .client({ name: "mirador" })
      .onNotification(acp.methods.client.session.update, (ctx) => this.listener.onSessionUpdate(ctx.params))
      .onNotification(ASYNC_TASK_UPDATE_METHOD, (params) => params as { sessionId: string; update: object }, (ctx) =>
        this.listener.onSessionUpdate({ sessionId: ctx.params.sessionId, update: ctx.params.update as acp.SessionUpdate }),
      )
      .onRequest(acp.methods.client.session.requestPermission, (ctx) =>
        this.listener.onPermissionRequest(ctx.params, ctx.signal),
      )
      .onRequest(acp.methods.client.elicitation.create, (ctx) => this.listener.onElicitationRequest(ctx.params, ctx.signal))
      .connect(stream);
    this.connection = connection;
    child.once("exit", (code, signal) => {
      goneBecause(this.stopReason ?? { kind: "exited", how: String(code ?? signal) });
      setTimeout(() => connection.close(), LAST_OUTPUT_AFTER_EXIT_MS).unref();
    });
    return this.initialize();
  }

  /**
   * A stop that comes while the start waits its turn or runs the pre-launch command finds no agent process to end; the
   * start ends there, as it would had the process been running, rather than start one its owner has let go of.
   */
  private endIfStoppedBeforeSpawning(ownStart: number) {
    const reason = this.stopReason;
    if (!reason) return;
    this.exited = Promise.resolve(reason);
    if (this.startsSoFar === ownStart) {
      this.connection = undefined;
      this.initialized = undefined;
      this.child = undefined;
      this.stopReason = undefined;
      this.listener.onExit(this, reason);
    }
    throw new HostProblemError({ code: "agent-gone", agent: this.spec.label, gone: reason });
  }

  /** An agent that never answers would hold up every later start of its kind, when they start one at a time. */
  private async initialize() {
    const givingUp = setTimeout(
      () => void this.stop({ kind: "no-answer", seconds: this.initializeTimeoutMs / 1000 }),
      this.initializeTimeoutMs,
    );
    try {
      return await this.failingWithExitReason((agent) =>
        agent.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            session: { notices: {} },
            ...formQuestionsCapability(this.spec.id),
            // Claude Code's background tasks come as session updates only to a client that claims the AIR asyncTasks
            // capability; an agent that knows no `_meta` ignores it.
            _meta: { jetbrains: { air: { version: 1, capabilities: ["asyncTasks"] } }, ...commandOutputCapability(this.spec.id) },
          },
          clientInfo: { name: "mirador", version: MIRADOR_VERSION },
        }),
      );
    } catch (error) {
      if (this.stopReason === undefined) void this.stop();
      throw error;
    } finally {
      clearTimeout(givingUp);
    }
  }

  /**
   * The command's output goes straight to the log file rather than through a pipe: a proxy it
   * starts in the background inherits the output and would otherwise hold the pipe open. Git Bash,
   * which cannot write to a handle opened for appending, opens the file itself; every other shell
   * gets a handle to it, so the command runs as written in the user's own shell, fish or csh too.
   */
  private async runPrelaunch() {
    if (!this.spec.prelaunch.trim()) return;
    const logPath = this.logPath();
    appendFileSync(logPath, "");
    const logSizeBefore = statSync(logPath).size;
    const shell = commandShell(() => process.env.SHELL || "/bin/sh", this.spec.environment);
    const isGitBash = process.platform === "win32" && shell.kind === "posix";
    const log = isGitBash ? "ignore" : openSync(logPath, "a");
    const command = isGitBash ? withOutputAppendedTo(logPath, this.spec.prelaunch) : this.spec.prelaunch;
    const failure = await new Promise<PrelaunchFailure | null>((resolve) => {
      const [program, ...args] = commandLine(shell, command);
      const prelaunch = spawn(program!, args, {
        env: this.spec.environment,
        stdio: ["ignore", log, log],
      });
      this.prelaunchProcess = prelaunch;
      const timeout = setTimeout(() => {
        prelaunch.kill();
        resolve({ kind: "timed-out", seconds: PRELAUNCH_TIMEOUT_MS / 1000 });
      }, PRELAUNCH_TIMEOUT_MS);
      prelaunch.once("error", (error) => {
        clearTimeout(timeout);
        resolve({ kind: "could-not-run", cause: error.message });
      });
      prelaunch.once("exit", (code, signal) => {
        clearTimeout(timeout);
        resolve(code === 0 ? null : { kind: "exited", how: String(code ?? signal) });
      });
    });
    this.prelaunchProcess = undefined;
    if (log !== "ignore") closeSync(log);
    const endedByStop = this.stopReason !== undefined;
    if (failure === null || endedByStop) return;
    const output = readFileSync(logPath).subarray(logSizeBefore).toString().trim().slice(-PRELAUNCH_OUTPUT_IN_ERRORS);
    throw new HostProblemError({ code: "prelaunch-failed", agent: this.spec.label, failure, output });
  }

  private logPath() {
    mkdirSync(this.logDir, { recursive: true });
    return join(this.logDir, `${this.spec.logName}.log`);
  }
}
