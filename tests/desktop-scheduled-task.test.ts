import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandResult } from "../desktop/src/core/commands.ts";
import { RunKeyEntry } from "../desktop/src/core/run-key.ts";
import { accountSidIn, HostScheduledTask, hostTaskArguments, hostTaskName, hostTaskScript, hostTaskXml, systemProgram } from "../desktop/src/core/scheduled-task.ts";
import { defaultSettings } from "../desktop/src/core/settings.ts";

const SID = "S-1-5-21-1004336348-1177238915-682003330-1001";
const TASK = `Mirador-host-4600-${SID}`;
const BUN = "C:\\Users\\me\\AppData\\Local\\com.sodre90.mirador\\stable\\app\\bin\\bun.exe";
const LOG = "C:\\Users\\me\\.mirador\\logs\\host.log";
const program = (name: string) => systemProgram(name);

const directory = mkdtempSync(join(tmpdir(), "mirador-task-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("the host's scheduled task", () => {
  test("is named for the port and the account, as task names are the machine's", () => {
    expect(accountSidIn(`"desktop-1\\me","${SID}"\r\n`)).toBe(SID);
    expect(() => accountSidIn("ERROR: Access is denied.")).toThrow("security identifier");
    expect(hostTaskName(4600, SID)).toBe(TASK);
  });

  test("runs the host from a script that sets its environment and logs its output, in any language", () => {
    const environment = { MIRADOR_PORT: "4790", MIRADOR_DATA_DIR: "C:\\Users\\Zoë\\Mirador & 100%" };
    expect(hostTaskScript({ bun: BUN, environment, logPath: LOG }).split("\r\n")).toEqual([
      "@echo off",
      "chcp 65001 >nul",
      'set "MIRADOR_PORT=4790"',
      'set "MIRADOR_DATA_DIR=C:\\Users\\Zoë\\Mirador & 100%%"',
      `"${BUN}" host/main.ts >> "${LOG}" 2>&1`,
      "",
    ]);
  });

  test("refuses what would end a quoted value early", () => {
    expect(() => hostTaskScript({ bun: BUN, environment: { MIRADOR_DATA_DIR: 'C:\\"quoted"' }, logPath: LOG })).toThrow('with " in');
  });

  test("runs the script in cmd, in a console that shows no window", () => {
    expect(hostTaskArguments("C:\\Users\\Zoë Smith\\.mirador\\host-task.cmd")).toBe(`--headless ${program("cmd.exe")} /d /c "C:\\Users\\Zoë Smith\\.mirador\\host-task.cmd"`);
  });

  test("starts at the account's login, at normal priority, never stopped for time or power, one run after another", () => {
    const xml = hostTaskXml({ port: 4600, sid: SID, hostDirectory: "C:\\app\\mirador", script: "C:\\data\\R&D\\host-task.cmd" });
    expect(xml).toContain(`<LogonTrigger>\n      <UserId>${SID}</UserId>`);
    expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(xml).toContain("<Priority>5</Priority>");
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(xml).toContain("<MultipleInstancesPolicy>Queue</MultipleInstancesPolicy>");
    expect(xml).toContain(`<Command>${program("conhost.exe")}</Command>`);
    expect(xml).toContain(`<Arguments>--headless ${program("cmd.exe")} /d /c &quot;C:\\data\\R&amp;D\\host-task.cmd&quot;</Arguments>`);
    expect(xml).toContain("<WorkingDirectory>C:\\app\\mirador</WorkingDirectory>");
  });
});

const HOST_PID = 500;
const CMD_PID = 400;
const CONHOST_PID = 300;

class TaskWorld {
  registered = false;
  running = false;
  hostIgnoresCtrlC = false;
  commands: string[] = [];
  interrupted: number[] = [];
  readonly files = { taskXml: join(mkdtempSync(join(directory, "data-")), "host-task.xml"), taskScript: "", pidFile: "" };
  readonly processes = new Map<number, string>();

  constructor() {
    this.files.taskScript = join(this.files.taskXml, "..", "host-task.cmd");
    this.files.pidFile = join(this.files.taskXml, "..", "background-host.pid");
  }

  startHost() {
    this.running = true;
    writeFileSync(this.files.pidFile, `${HOST_PID}\n`);
    this.processes.set(HOST_PID, `"${BUN}"  host/main.ts  `);
    this.processes.set(CMD_PID, `${program("cmd.exe")}  /d /c ${this.files.taskScript}`);
    this.processes.set(CONHOST_PID, `${program("conhost.exe")} --headless ${program("cmd.exe")} /d /c ${this.files.taskScript}`);
  }

  endHost() {
    this.running = false;
    this.processes.clear();
  }

  async run(argv: string[]): Promise<CommandResult> {
    const [executable, ...arguments_] = argv;
    const command = `${executable!.split("\\").at(-1)} ${arguments_.join(" ")}`;
    if (executable === program("whoami.exe")) return { exitCode: 0, output: `"desktop-1\\me","${SID}"` };
    this.commands.push(command.replace(SID, "SID").replace(this.files.taskXml, "<xml>"));
    const verb = arguments_[0];
    if (verb === "/query") return { exitCode: this.registered ? 0 : 1, output: "" };
    if (verb === "/create") this.registered = true;
    if (verb === "/delete") this.registered = false;
    if (verb === "/run") this.startHost();
    if (verb === "/end") this.processes.delete(CONHOST_PID);
    if (executable === program("taskkill.exe")) this.endHost();
    return { exitCode: 0, output: "" };
  }

  task() {
    return new HostScheduledTask(
      4600,
      this.files,
      { shell: "", overrides: {}, logPath: join(this.files.taskXml, "..", "logs", "host.log") },
      {
        run: (argv) => this.run(argv),
        processes: { commandLine: (pid) => this.processes.get(pid) ?? null, terminate: () => {} },
        parentOf: (pid) => ({ [HOST_PID]: CMD_PID, [CMD_PID]: CONHOST_PID })[pid] ?? null,
        interrupt: async (pid) => {
          this.interrupted.push(pid);
          if (!this.hostIgnoresCtrlC) this.endHost();
          return true;
        },
        pause: async () => {},
      },
    );
  }
}

const settings = defaultSettings({ hostDirectory: "C:\\app\\mirador", bun: BUN });

describe("HostScheduledTask", () => {
  test("registers the task and runs it, and tells the host its task and where to write its pid", async () => {
    const world = new TaskWorld();
    await world.task().ensureLoaded(settings);
    expect(world.commands).toEqual(["schtasks.exe /query /tn Mirador-host-4600-SID", "schtasks.exe /create /tn Mirador-host-4600-SID /xml <xml> /f", "schtasks.exe /run /tn Mirador-host-4600-SID"]);
    const xml = readFileSync(world.files.taskXml);
    expect([...xml.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(xml.subarray(2).toString("utf16le")).toContain(`/d /c &quot;${world.files.taskScript}&quot;</Arguments>`);
    const script = readFileSync(world.files.taskScript, "utf8");
    expect(script).toContain(`set "MIRADOR_SCHEDULED_TASK=${TASK}"`);
    expect(script).toContain(`set "MIRADOR_PID_FILE=${world.files.pidFile}"`);
    expect(await world.task().isLoaded()).toBe(true);
  });

  test("leaves a running host alone when the task is as registered", async () => {
    const world = new TaskWorld();
    await world.task().ensureLoaded(settings);
    world.commands.length = 0;
    await world.task().ensureLoaded(settings);
    expect(world.commands).toEqual(["schtasks.exe /query /tn Mirador-host-4600-SID"]);
  });

  test("runs a registered task whose host is not running, as after an update stopped it", async () => {
    const world = new TaskWorld();
    await world.task().ensureLoaded(settings);
    world.endHost();
    world.commands.length = 0;
    await world.task().ensureLoaded(settings);
    expect(world.commands).toEqual(["schtasks.exe /query /tn Mirador-host-4600-SID", "schtasks.exe /run /tn Mirador-host-4600-SID"]);
  });

  test("stops the host with Ctrl-C before registering a changed task, then runs it", async () => {
    const world = new TaskWorld();
    await world.task().ensureLoaded(settings);
    world.commands.length = 0;
    await world.task().ensureLoaded({ ...settings, hostDirectory: "C:\\src\\mirador" });
    expect(world.interrupted).toEqual([HOST_PID]);
    expect(world.commands).toEqual([
      "schtasks.exe /query /tn Mirador-host-4600-SID",
      "schtasks.exe /end /tn Mirador-host-4600-SID",
      "schtasks.exe /create /tn Mirador-host-4600-SID /xml <xml> /f",
      "schtasks.exe /run /tn Mirador-host-4600-SID",
    ]);
  });

  test("ends the host's process tree when Ctrl-C does not stop it, and the console left behind", async () => {
    const world = new TaskWorld();
    await world.task().ensureLoaded(settings);
    world.hostIgnoresCtrlC = true;
    world.commands.length = 0;
    await world.task().restart();
    expect(world.commands).toEqual(["taskkill.exe /T /F /PID 500", "schtasks.exe /end /tn Mirador-host-4600-SID", "schtasks.exe /run /tn Mirador-host-4600-SID"]);
  });

  test("sends no Ctrl-C to a pid that is no longer the task's host", async () => {
    const world = new TaskWorld();
    await world.task().ensureLoaded(settings);
    world.processes.set(CMD_PID, "C:\\WINDOWS\\system32\\cmd.exe");
    world.commands.length = 0;
    await world.task().restart();
    expect(world.interrupted).toEqual([]);
    expect(world.commands).toEqual(["schtasks.exe /end /tn Mirador-host-4600-SID", "schtasks.exe /run /tn Mirador-host-4600-SID"]);
  });

  test("deletes the task before stopping the host, so no run it queued starts it again", async () => {
    const world = new TaskWorld();
    await world.task().ensureLoaded(settings);
    world.commands.length = 0;
    await world.task().remove();
    expect(world.commands).toEqual(["schtasks.exe /query /tn Mirador-host-4600-SID", "schtasks.exe /delete /tn Mirador-host-4600-SID /f", "schtasks.exe /end /tn Mirador-host-4600-SID"]);
    expect(world.interrupted).toEqual([HOST_PID]);
    expect(existsSync(world.files.taskXml)).toBe(false);
    expect(existsSync(world.files.taskScript)).toBe(false);
    expect(existsSync(world.files.pidFile)).toBe(false);
  });

  test("stops the host for an update, leaving the task to start it at the next login or start of the app", async () => {
    const world = new TaskWorld();
    await world.task().ensureLoaded(settings);
    world.commands.length = 0;
    await world.task().stopBeforeUpdate();
    expect(world.commands).toEqual(["schtasks.exe /end /tn Mirador-host-4600-SID"]);
    expect(world.registered).toBe(true);
    expect(world.processes.size).toBe(0);
  });
});

describe("RunKeyEntry", () => {
  const LAUNCHER = "C:\\Users\\me\\AppData\\Local\\com.sodre90.mirador\\stable\\app\\bin\\launcher.exe";
  const recorder = (valueExists = true) => {
    const commands: string[][] = [];
    const run = (argv: string[]) => {
      commands.push(argv);
      return { exitCode: argv[1] === "query" && !valueExists ? 1 : 0, output: "" };
    };
    return { commands, run };
  };

  test("names the launcher in the account's Run key, under a value for the port", () => {
    const { commands, run } = recorder();
    new RunKeyEntry(4600, LAUNCHER, {}, run).enable();
    expect(commands).toEqual([[program("reg.exe"), "add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "Mirador-4600", "/t", "REG_SZ", "/d", `"${LAUNCHER}"`, "/f"]]);
  });

  test("removes the value, and nothing when there is none", () => {
    const present = recorder(true);
    new RunKeyEntry(4600, LAUNCHER, {}, present.run).disable();
    expect(present.commands.map((argv) => argv[1])).toEqual(["query", "delete"]);
    const absent = recorder(false);
    new RunKeyEntry(4600, LAUNCHER, {}, absent.run).disable();
    expect(absent.commands.map((argv) => argv[1])).toEqual(["query"]);
  });

  test("is not there for a copy that is not installed, or one on another port or data folder", () => {
    expect(new RunKeyEntry(4600, LAUNCHER, {}, recorder().run).available).toBe(true);
    expect(new RunKeyEntry(4600, null, {}, recorder().run).available).toBe(false);
    const elsewhere = new RunKeyEntry(4790, LAUNCHER, { MIRADOR_PORT: "4790" }, recorder().run);
    expect(elsewhere.available).toBe(false);
    expect(() => elsewhere.enable()).toThrow("only on its default port and data folder");
  });
});
