import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, win32 } from "node:path";
import { HOST_RELAUNCH } from "../../../shared/host-relaunch.ts";
import type { BackgroundHost, BackgroundHostEnvironment } from "./background-host.ts";
import type { CommandRunner } from "./commands.ts";
import { HOST_ENTRY, isHostCommandLine } from "./host-command.ts";
import { PidFileOnDisk, type ProcessTable } from "./processes.ts";
import type { DesktopSettings } from "./settings.ts";

/** By its full path, as Git for Windows puts programs of the same names (`whoami`, `find`) before the system's on the PATH. */
export const systemProgram = (program: string, systemRoot = process.env.SystemRoot ?? "C:\\Windows") => win32.join(systemRoot, "System32", program);

/** Task names are the machine's, so the account's security identifier keeps two accounts' tasks apart. */
export const hostTaskName = (port: number, sid: string) => `Mirador-host-${port}-${sid}`;

export function accountSidIn(whoamiOutput: string) {
  const sid = /"(S-1-[\d-]+)"$/.exec(whoamiOutput.trim())?.[1];
  if (!sid) throw new Error(`Could not tell this account's security identifier from "${whoamiOutput.trim()}"`);
  return sid;
}

export interface HostScriptSpec {
  bun: string;
  environment: Record<string, string>;
  logPath: string;
}

export interface HostTaskSpec {
  port: number;
  sid: string;
  hostDirectory: string;
  script: string;
}

const ENDS_A_QUOTED_VALUE = /["\r\n]/;
/** A script's `%` reads as the start of a variable's name unless doubled. */
const batchText = (text: string) => text.replaceAll("%", "%%");

/**
 * The script cmd runs for the task: it sets the host's environment and appends its output to the log. It is UTF-8 from
 * its second line on, so paths in any language survive, where cmd otherwise reads a script in the system's code page.
 */
export function hostTaskScript({ bun, environment, logPath }: HostScriptSpec) {
  for (const value of [bun, logPath, ...Object.values(environment)]) {
    if (ENDS_A_QUOTED_VALUE.test(value)) throw new Error(`The host cannot run in the background on Windows with " in ${value}`);
  }
  const assignments = Object.entries(environment).map(([name, value]) => batchText(`set "${name}=${value}"`));
  return ["@echo off", "chcp 65001 >nul", ...assignments, batchText(`"${bun}" ${HOST_ENTRY} >> "${logPath}" 2>&1`), ""].join("\r\n");
}

/**
 * conhost gives the host a console that shows no window: a task that runs Bun itself opens one, which Windows 11 hands
 * to the Terminal, as would every program the host runs. conhost splits its arguments and joins them again, dropping
 * the quotes cmd needs around a value with spaces, so the commands are in a script rather than on the command line.
 */
export const hostTaskArguments = (script: string) => `--headless ${systemProgram("cmd.exe")} /d /c "${script}"`;

const xmlText = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/**
 * Started at the account's login, at normal priority (a task's default is below it), and never stopped for time or
 * power. A run asked for while the host runs waits for it to exit, which is how the host restarts itself.
 */
export const hostTaskXml = (spec: HostTaskSpec) => `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Mirador host on port ${spec.port}</Description>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <UserId>${spec.sid}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <MultipleInstancesPolicy>Queue</MultipleInstancesPolicy>
    <Priority>5</Priority>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
  </Settings>
  <Triggers>
    <LogonTrigger>
      <UserId>${spec.sid}</UserId>
    </LogonTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlText(systemProgram("conhost.exe"))}</Command>
      <Arguments>${xmlText(hostTaskArguments(spec.script))}</Arguments>
      <WorkingDirectory>${xmlText(spec.hostDirectory)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;

/** schtasks reads a task's XML as UTF-16 with its byte order mark, and refuses UTF-8. */
const UTF16_BOM = Buffer.from([0xff, 0xfe]);

export interface HostTaskPorts {
  run: CommandRunner;
  processes: ProcessTable;
  parentOf(pid: number): number | null;
  interrupt(pid: number): Promise<boolean>;
  pause(milliseconds: number): Promise<void>;
}

export interface HostTaskFiles {
  /** The XML the task was registered with, to tell whether it changed: schtasks gives it back in a form of its own. */
  taskXml: string;
  taskScript: string;
  pidFile: string;
}

interface TaskHost {
  pid: number;
  /** The cmd and conhost the task runs the host in, which hold the host's directory as theirs too. */
  wrapper: number[];
}

const POLL_MILLISECONDS = 250;
const HOST_STOP_POLLS = 40;
/** cmd waits at "Terminate batch job (Y/N)?" after a Ctrl-C, for an answer a console without a window never gets. */
const WRAPPER_STOP_POLLS = 4;

function readText(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The Windows counterpart of the background LaunchAgent: a scheduled task of this account's that runs the host from login on. */
export class HostScheduledTask implements BackgroundHost {
  private readonly pidFile: PidFileOnDisk;
  private sid: string | null = null;

  constructor(
    private readonly port: number,
    private readonly files: HostTaskFiles,
    private readonly environment: BackgroundHostEnvironment,
    private readonly ports: HostTaskPorts,
  ) {
    this.pidFile = new PidFileOnDisk(files.pidFile);
  }

  async isLoaded() {
    return (await this.schtasks("/query", "/tn", await this.taskName())).exitCode === 0;
  }

  /** Registering a task does not run it, and a run asked for while the host starts would queue a second one. */
  async ensureLoaded(settings: DesktopSettings) {
    const script = hostTaskScript(await this.scriptSpecFor(settings));
    const xml = hostTaskXml({ port: this.port, sid: await this.accountSid(), hostDirectory: settings.hostDirectory, script: this.files.taskScript });
    const registered = await this.isLoaded();
    if (!registered || this.registeredXml() !== xml || readText(this.files.taskScript) !== script) {
      if (registered) await this.stop();
      await this.register(xml, script);
    }
    if (this.runningHost() === null) await this.runTask();
  }

  async restart() {
    await this.stop();
    await this.runTask();
  }

  /** Deleting the task first drops a run it queued, which would otherwise start the host again once it stopped. */
  async remove() {
    if (await this.isLoaded()) await this.schtasksOrThrow("delete the host's task", "/delete", "/tn", await this.taskName(), "/f");
    await this.stop();
    rmSync(this.files.taskXml, { force: true });
    rmSync(this.files.taskScript, { force: true });
  }

  /** A host run from the app's own copy works in the app's folder, which Windows does not let an update replace meanwhile. */
  stopBeforeUpdate() {
    return this.stop();
  }

  /**
   * Ctrl-C stops the host as SIGINT does elsewhere, its services first. `schtasks /end` ends only the console the task
   * started and leaves the host running, so it comes after, for a console that a program the host started still holds.
   */
  private async stop() {
    const host = this.runningHost();
    if (host !== null && !((await this.ports.interrupt(host.pid)) && (await this.exited(host.pid, HOST_STOP_POLLS)))) await this.endProcessTree(host.pid);
    await this.schtasks("/end", "/tn", await this.taskName());
    for (const pid of host?.wrapper ?? []) {
      if (!(await this.exited(pid, WRAPPER_STOP_POLLS))) await this.endProcessTree(pid);
    }
    this.pidFile.clear();
  }

  /**
   * The pid the host wrote, while that process is still a host started by the task's script: a reused pid gets no
   * Ctrl-C. Its conhost may be gone already, ended on its own by `schtasks /end`.
   */
  private runningHost(): TaskHost | null {
    const pid = this.pidFile.read();
    if (pid === null || !isHostCommandLine(this.ports.processes.commandLine(pid) ?? "")) return null;
    const shell = this.ports.parentOf(pid);
    if (shell === null || !this.commandLineOf(shell).toLowerCase().includes(this.files.taskScript.toLowerCase())) return null;
    const console = this.ports.parentOf(shell);
    return { pid, wrapper: console !== null && /\bconhost\.exe\b/i.test(this.commandLineOf(console)) ? [shell, console] : [shell] };
  }

  private commandLineOf(pid: number) {
    return this.ports.processes.commandLine(pid) ?? "";
  }

  private async exited(pid: number, polls: number) {
    for (let poll = 0; poll < polls; poll++) {
      if (this.ports.processes.commandLine(pid) === null) return true;
      await this.ports.pause(POLL_MILLISECONDS);
    }
    return this.ports.processes.commandLine(pid) === null;
  }

  private async endProcessTree(pid: number) {
    await this.ports.run([systemProgram("taskkill.exe"), "/T", "/F", "/PID", String(pid)]);
  }

  private async register(xml: string, script: string) {
    mkdirSync(dirname(this.environment.logPath), { recursive: true });
    mkdirSync(dirname(this.files.taskXml), { recursive: true });
    writeFileSync(this.files.taskScript, script);
    writeFileSync(this.files.taskXml, Buffer.concat([UTF16_BOM, Buffer.from(xml, "utf16le")]));
    const { exitCode, output } = await this.schtasks("/create", "/tn", await this.taskName(), "/xml", this.files.taskXml, "/f");
    if (exitCode === 0) return;
    rmSync(this.files.taskXml, { force: true });
    throw new Error(`Could not register the host's task: ${output || `schtasks exited with ${exitCode}`}`);
  }

  private registeredXml() {
    try {
      return readFileSync(this.files.taskXml).subarray(UTF16_BOM.length).toString("utf16le");
    } catch {
      return null;
    }
  }

  private async runTask() {
    await this.schtasksOrThrow("start the host's task", "/run", "/tn", await this.taskName());
  }

  private async scriptSpecFor(settings: DesktopSettings): Promise<HostScriptSpec> {
    const { overrides, logPath } = this.environment;
    const environment = { ...overrides, [HOST_RELAUNCH.scheduledTask]: await this.taskName(), [HOST_RELAUNCH.pidFile]: this.files.pidFile };
    return { bun: settings.bun, environment, logPath };
  }

  private async taskName() {
    return hostTaskName(this.port, await this.accountSid());
  }

  private async accountSid() {
    if (this.sid === null) {
      const { exitCode, output } = await this.ports.run([systemProgram("whoami.exe"), "/user", "/fo", "csv", "/nh"]);
      if (exitCode !== 0) throw new Error(`Could not tell this account's security identifier: ${output}`);
      this.sid = accountSidIn(output);
    }
    return this.sid;
  }

  private schtasks(...arguments_: string[]) {
    return this.ports.run([systemProgram("schtasks.exe"), ...arguments_]);
  }

  private async schtasksOrThrow(action: string, ...arguments_: string[]) {
    const { exitCode, output } = await this.schtasks(...arguments_);
    if (exitCode !== 0) throw new Error(`Could not ${action}: ${output || `schtasks exited with ${exitCode}`}`);
  }
}
