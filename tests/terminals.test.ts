import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_TERMINALS_PER_TAB, type Conversation, type TerminalTab } from "../shared/model.ts";
import type { ServerMessage } from "../shared/protocol.ts";
import { findPowerShell, programName } from "../host/command-shell.ts";
import { Hub, type BrowserSocket } from "../host/hub.ts";
import { Store } from "../host/store.ts";
import { readTitle, RESTARTED_NOTE, TerminalService } from "../host/terminals.ts";

let workspaceDir: string;
let store: Store;
let terminals: TerminalService;
let hub: Hub;
const TEST_SAVE_DELAY_MS = 50;
const originalShell = process.env.SHELL;
const originalHome = process.env.HOME;

/** Where sh is bash, as on Arch, its login profile may set the title at every prompt, over the one a test sets. */
const stoppingThePromptsTitle = "unset PROMPT_COMMAND; ";

/**
 * What the tests type differs with the terminal's shell: sh here, and on Windows PowerShell, where $$ means something
 * else, printf is missing, and sleep runs inside the shell, so it never shows as busy.
 */
const shell =
  process.platform === "win32"
    ? {
        name: programName(findPowerShell(process.env)),
        pid: "$PID",
        settingTitle: (title: string) => `$Host.UI.RawUI.WindowTitle = '${title}'`,
        runningBun: (script: string) => `& '${process.execPath}' -e "${script}"`,
      }
    : {
        name: "sh",
        pid: "$$",
        settingTitle: (title: string) => `${stoppingThePromptsTitle}printf '\\033]0;%s\\007' '${title}'`,
        runningBun: (script: string) => `'${process.execPath}' -e "${script}"`,
      };

/** Enter is a carriage return, as a browser's terminal sends it. */
const typing = (terminalId: string, line: string) => terminals.input(terminalId, `${line}\r`);

const waitingForALine = [process.execPath, "-e", "process.stdin.once('data', () => process.exit(0))"];

function fakeBrowser() {
  const received: ServerMessage[] = [];
  const socket = {
    data: { subscriptions: new Set<string>(), terminalConversationId: null },
    send: (payload: string) => received.push(JSON.parse(payload)),
  } as unknown as BrowserSocket;
  hub.add(socket);
  return { socket, received };
}

const outputOf = (received: ServerMessage[]) =>
  received.flatMap((message) => (message.type === "terminal.output" ? [message.data] : [])).join("");

const lastTabs = (received: ServerMessage[]): TerminalTab[] | undefined =>
  received.findLast((message) => message.type === "terminals.listed")?.tabs;

async function eventually<T>(read: () => T, isDone: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (!isDone(read()) && Date.now() < deadline) await Bun.sleep(20);
  return read();
}

const outputContaining = (received: ServerMessage[], text: string) =>
  eventually(() => outputOf(received), (output) => output.includes(text));

/** A negative pid asks after a whole process group. */
const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const beside = (terminalId: string) => ({ terminalId, axis: "columns" as const });
const below = (terminalId: string) => ({ terminalId, axis: "rows" as const });

const tabsOnceSettled = (received: ServerMessage[], isSettled: (tabs: TerminalTab[]) => boolean) =>
  eventually(() => lastTabs(received) ?? [], isSettled);

const conversationInWorkspace = (id: string): Omit<Conversation, "position"> => ({
  id,
  workspaceId: "w1",
  harness: "claude",
  profileId: null,
  title: id,
  titleSetByUser: false,
  acpSessionId: null,
  askMode: "wait",
  bypassPermissions: false,
  status: "idle",
  statusDetail: null,
  openInTerminal: null,
  contextUsage: null,
  queuedMessages: [],
  usageLimit: null,
  jobWaits: [],
  asyncTasks: [],
  waitingFor: null,
  pendingRequest: null,
  lastWords: null,
  activity: null,
  configOptions: [],
  createdAt: 1,
  updatedAt: 1,
});

beforeEach(async () => {
  workspaceDir = await realpath(await mkdtemp(join(tmpdir(), "mirador-terminals-")));
  process.env.SHELL = "/bin/sh";
  process.env.HOME = workspaceDir;
  store = new Store(":memory:");
  store.insertWorkspace({ id: "w1", name: "project", path: workspaceDir, defaultLaunch: { harness: "claude", profileId: null }, createdAt: 1 });
  ["c1", "c2"].forEach((id) => store.insertConversation(conversationInWorkspace(id)));
  hub = new Hub();
  terminals = new TerminalService(hub, store, TEST_SAVE_DELAY_MS);
});

/** Stops the host's terminals and starts the next run's on the same store, as a restart does. */
async function restartHost() {
  await terminals.shutdown();
  terminals = new TerminalService(hub, store, TEST_SAVE_DELAY_MS);
}

const replayed = (received: ServerMessage[], terminalId: string) =>
  received.flatMap((message) => (message.type === "terminal.replayed" && message.terminalId === terminalId ? [message.data] : [])).at(-1) ?? "";

const savedOutputOf = (terminalId: string) => store.listTerminalTabs("c1")[0]?.scrollback.get(terminalId) ?? "";

/** Windows keeps a folder busy for a moment after the last process in it ended, and Bun's rm takes no maxRetries. */
async function removeOnceFree(folder: string) {
  const giveUpAt = Date.now() + 5_000;
  while (true) {
    try {
      return await rm(folder, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY" || Date.now() >= giveUpAt) throw error;
      await Bun.sleep(100);
    }
  }
}

afterEach(async () => {
  await terminals.shutdown();
  process.env.SHELL = originalShell;
  process.env.HOME = originalHome;
  await removeOnceFree(workspaceDir);
});

test("a terminal runs a shell in the workspace folder, sized as asked, and streams to browsers attached to its conversation, not to another of the workspace", async () => {
  const watching = fakeBrowser();
  const elsewhere = fakeBrowser();
  terminals.attach(watching.socket, "c1");
  terminals.attach(elsewhere.socket, "c2");
  const { terminalId } = terminals.open("c1", 100, 30);

  const printingFolderAndSize = shell.runningBun("console.log(process.cwd()); console.log(process.stdout.rows + ' ' + process.stdout.columns)");
  typing(terminalId, printingFolderAndSize);
  expect(await outputContaining(watching.received, "30 100")).toContain(`${workspaceDir}\r\n30 100`);
  terminals.resize(terminalId, 120, 40);
  typing(terminalId, printingFolderAndSize);
  expect(await outputContaining(watching.received, "40 120")).toContain("40 120");
  expect(elsewhere.received.filter(({ type }) => type.startsWith("terminal"))).toEqual([{ type: "terminals.listed", conversationId: "c2", tabs: [] }]);
});

test("a browser that attaches later gets the tabs and can replay what each terminal printed", async () => {
  const first = fakeBrowser();
  terminals.attach(first.socket, "c1");
  const { tabId, terminalId } = terminals.open("c1", 100, 30);
  typing(terminalId, "echo before-reload");
  expect(await outputContaining(first.received, "before-reload\r\n")).toContain("before-reload\r\n");

  const reloaded = fakeBrowser();
  terminals.attach(reloaded.socket, "c1");
  terminals.replay(reloaded.socket, terminalId);
  expect(lastTabs(reloaded.received)).toMatchObject([{ id: tabId, name: shell.name, terminals: [{ id: terminalId }], layout: { terminalId } }]);
  const replayed = reloaded.received.find((message) => message.type === "terminal.replayed");
  expect(replayed).toMatchObject({ terminalId, data: expect.stringContaining("before-reload\r\n") });
});

test("clearing a terminal forgets the output above the cursor's line, in every window and in what a reload replays", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const { terminalId } = terminals.open("c1", 100, 30);
  typing(terminalId, "echo above-$((1+1))-the-cursor");
  await outputContaining(browser.received, "above-2-the-cursor\r\n");
  terminals.input(terminalId, "typed-on-the-cursor-line");
  await outputContaining(browser.received, "typed-on-the-cursor-line");

  terminals.clear(terminalId);
  expect(browser.received.at(-1)).toEqual({ type: "terminal.cleared", terminalId });
  terminals.replay(browser.socket, terminalId);
  const replayed = browser.received.findLast((message) => message.type === "terminal.replayed");
  expect(replayed).toMatchObject({ data: expect.stringContaining("typed-on-the-cursor-line") });
  expect(replayed).not.toMatchObject({ data: expect.stringContaining("above-2-the-cursor") });
});

/**
 * Windows' console carries a program's sequences out itself and passes on its own: a program's cursor key mode stays with
 * the console, and no sequence reaches the host cut by a line break.
 */
const passesSequencesOnAsWritten = process.platform !== "win32";

/** Application cursor keys, as a full-screen program switches them on once as it starts: the arrow keys then send ESC O A and so on. */
const cursorKeysOn = "\x1b[?1h";
/** The mode switches a replay starts with, ahead of the output it kept. */
const leadingSwitches = (history: string) => history.match(/^(?:\x1b\[\?[\d;]*[hl]|\x1b[=>])*/)![0];
const switchingCursorKeysOn = (marker: string) => shell.runningBun(`process.stdout.write('\\x1b[?1h'); console.log('${marker}-' + (2+3))`);

test.if(passesSequencesOnAsWritten)("a replay switches on again what the output the scrollback lost had switched on, as a full-screen program's cursor keys", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const { terminalId } = terminals.open("c1", 80, 24);
  const fillingTheScrollback = shell.runningBun("for (let i = 0; i < 4000; i++) console.log('line-' + i + ' ' + '0'.repeat(80))");
  typing(terminalId, `${switchingCursorKeysOn("cursor-keys")}; ${fillingTheScrollback}; echo filled-$((2*3))`);
  await eventually(() => outputOf(browser.received), (output) => output.includes("filled-6"), 20_000);

  terminals.replay(browser.socket, terminalId);
  const history = replayed(browser.received, terminalId);
  expect(history).not.toContain("cursor-keys-5");
  expect(leadingSwitches(history)).toContain(cursorKeysOn);
}, 30_000);

test.if(passesSequencesOnAsWritten)("a replay after clearing a terminal switches on again what the cleared output had switched on", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const { terminalId } = terminals.open("c1", 80, 24);
  typing(terminalId, switchingCursorKeysOn("cleared-cursor-keys"));
  await outputContaining(browser.received, "cleared-cursor-keys-5\r\n");

  terminals.clear(terminalId);
  terminals.replay(browser.socket, terminalId);
  const history = replayed(browser.received, terminalId);
  expect(history).not.toContain("cleared-cursor-keys-5");
  expect(leadingSwitches(history)).toContain(cursorKeysOn);
});

/** A colour whose sequence has a line break inside, which xterm.js carries out without ending the sequence: clearing cuts it there. */
const printingAColourWithALineBreakInside = shell.runningBun("process.stdout.write('\\x1b[3\\n1mred-' + (2+3))");
const colourWhole = "\x1b[3\r\n1mred-5";

test.if(passesSequencesOnAsWritten)("a replay after clearing a terminal in the middle of a sequence reads the sequence whole, not its rest as text", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const { terminalId } = terminals.open("c1", 80, 24);
  typing(terminalId, printingAColourWithALineBreakInside);
  await outputContaining(browser.received, "red-5");

  terminals.clear(terminalId);
  terminals.replay(browser.socket, terminalId);
  expect(replayed(browser.received, terminalId)).toContain(colourWhole);
});

test.if(passesSequencesOnAsWritten)("output kept over a restart comes back with the start of the sequence its scrollback was cut in", async () => {
  const before = fakeBrowser();
  terminals.attach(before.socket, "c1");
  const { terminalId } = terminals.open("c1", 80, 24);
  typing(terminalId, printingAColourWithALineBreakInside);
  await outputContaining(before.received, "red-5");
  terminals.clear(terminalId);

  await restartHost();
  const after = fakeBrowser();
  terminals.attach(after.socket, "c1");
  terminals.replay(after.socket, terminalId);
  const history = replayed(after.received, terminalId);
  expect(history).toContain(colourWhole);
  expect(history.indexOf(RESTARTED_NOTE)).toBeGreaterThan(history.indexOf(colourWhole));
}, 15_000);

test("new tabs are named after the shell with the lowest free number, and a tab splits into at most four terminals", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const first = terminals.open("c1", 80, 24);
  const second = terminals.open("c1", 80, 24);
  const splits = Array.from({ length: MAX_TERMINALS_PER_TAB - 1 }, () => terminals.open("c1", 80, 24, beside(first.terminalId)));

  expect(splits.every(({ tabId }) => tabId === first.tabId)).toBe(true);
  expect(lastTabs(browser.received)?.map(({ name, terminals }) => [name, terminals.length])).toEqual([
    [shell.name, MAX_TERMINALS_PER_TAB],
    [`${shell.name} 2`, 1],
  ]);
  expect(() => terminals.open("c1", 80, 24, beside(first.terminalId))).toThrow(`A tab holds at most ${MAX_TERMINALS_PER_TAB} terminals.`);

  terminals.closeTab(second.tabId);
  expect((await tabsOnceSettled(browser.received, (tabs) => tabs.length === 1)).map(({ name }) => name)).toEqual([shell.name]);
  expect(() => terminals.open("c1", 80, 24, beside(second.terminalId))).toThrow("That terminal is closed.");
  terminals.open("c1", 80, 24);
  expect(lastTabs(browser.received)?.map(({ name }) => name)).toEqual([shell.name, `${shell.name} 2`]);
});

test.if(process.platform === "win32")("on Windows a new tab runs PowerShell in the workspace folder, and is named after it, not after the path its console is titled with", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const { terminalId } = terminals.open("c1", 100, 30);

  terminals.input(terminalId, "Write-Output \"in $((Get-Location).Path) with $($PSVersionTable.PSEdition)\"\r");
  expect(await outputContaining(browser.received, `in ${workspaceDir} with`)).toMatch(/with (Desktop|Core)/);
  const [tab] = lastTabs(browser.received)!;
  expect(tab?.name).toMatch(/^(powershell|pwsh)$/);
  expect(tab?.terminals[0]?.title).toBeNull();
});

test.if(process.platform === "win32")("on Windows a tab running Windows PowerShell keeps its own name, not the title Windows PowerShell gives itself", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  terminals.openProgram("c1", 80, 24, { tabName: "process 42", command: ["powershell.exe", "-NoLogo", "-NoProfile", "-Command", "Write-Output followed-it; [void][Console]::ReadLine()"] });

  await outputContaining(browser.received, "followed-it");
  const [tab] = lastTabs(browser.received)!;
  expect(tab?.name).toBe("process 42");
  expect(tab?.terminals[0]?.title).toBeNull();
});

test.if(process.platform === "win32")("on Windows a terminal whose title goes back to its console's program path goes back to its tab's name", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const { terminalId } = terminals.open("c1", 80, 24);
  typing(terminalId, shell.settingTitle("my-title"));
  await tabsOnceSettled(browser.received, ([only]) => only?.terminals[0]?.title === "my-title");

  typing(terminalId, `${shell.settingTitle(findPowerShell(process.env))}; Write-Output ('title-' + 'reset')`);
  await outputContaining(browser.received, "title-reset");
  expect(lastTabs(browser.received)?.[0]?.terminals[0]?.title).toBeNull();
});

test.if(process.platform === "win32")("on Windows closing unless busy closes a terminal at its prompt, keeps one running a program, naming it, and closing that ends the program too", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const idle = terminals.open("c1", 80, 24);
  const working = terminals.open("c1", 80, 24, beside(idle.terminalId));
  terminals.input(working.terminalId, `& '${process.execPath}' -e "console.log('started-' + process.pid); setTimeout(() => {}, 30000)"\r`);
  const program = Number(await eventually(() => outputOf(browser.received).match(/started-(\d+)/)?.[1], (pid) => pid !== undefined));

  await terminals.closeUnlessBusy(browser.socket, working.terminalId);
  expect(browser.received.findLast((message) => message.type === "terminal.busy")).toEqual({ type: "terminal.busy", terminalId: working.terminalId, command: "bun" });
  await terminals.closeUnlessBusy(browser.socket, idle.terminalId);
  const [left] = await tabsOnceSettled(browser.received, ([only]) => only?.terminals.length === 1);
  expect(left?.terminals.map(({ id }) => id)).toEqual([working.terminalId]);

  expect(isRunning(program)).toBe(true);
  terminals.close(working.terminalId);
  expect(await eventually(() => isRunning(program), (running) => !running)).toBe(false);
}, 20_000);

test.if(process.platform === "win32")("on Windows closing a terminal ends what its shell started outside the terminal too", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const { terminalId } = terminals.open("c1", 80, 24);
  const detached = `Start-Process -PassThru -WindowStyle Hidden -FilePath '${process.execPath}' -ArgumentList '-e', '"setTimeout(() => {}, 30000)"'`;
  terminals.input(terminalId, `Write-Output "started-$((${detached}).Id)"\r`);
  const program = Number(await eventually(() => outputOf(browser.received).match(/started-(\d+)/)?.[1], (pid) => pid !== undefined));

  expect(isRunning(program)).toBe(true);
  terminals.close(terminalId);
  expect(await eventually(() => isRunning(program), (running) => !running)).toBe(false);
}, 20_000);

test("a terminal that exits leaves its tab, and the tab goes with its last terminal", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const kept = terminals.open("c1", 80, 24);
  const exiting = terminals.open("c1", 80, 24, beside(kept.terminalId));
  typing(exiting.terminalId, "exit 3");
  const exited = await eventually(() => browser.received.find((message) => message.type === "terminal.exited"), (message) => message !== undefined);
  expect(exited).toEqual({ type: "terminal.exited", terminalId: exiting.terminalId, exitCode: 3 });
  expect(lastTabs(browser.received)).toMatchObject([{ id: kept.tabId, terminals: [{ id: kept.terminalId }] }]);

  terminals.close(kept.terminalId);
  expect(await tabsOnceSettled(browser.received, (tabs) => tabs.length === 0)).toEqual([]);
});

test("each terminal in a tab carries the title its shell sets", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const { tabId, terminalId } = terminals.open("c1", 80, 24);
  const split = terminals.open("c1", 80, 24, beside(terminalId));
  typing(split.terminalId, shell.settingTitle("my-title"));
  const [tab] = await tabsOnceSettled(browser.received, ([only]) => only?.terminals[1]?.title === "my-title");
  expect(tab?.terminals.map(({ id }) => id)).toEqual([terminalId, split.terminalId]);
  expect(tab?.terminals[0]?.title).not.toBe("my-title");
});

test("a runaway title is cut to 200 characters", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const { terminalId } = terminals.open("c1", 80, 24);
  typing(terminalId, shell.settingTitle("x".repeat(500)));
  const [tab] = await tabsOnceSettled(browser.received, ([only]) => only?.terminals[0]?.title?.startsWith("x") === true);
  expect(tab?.terminals[0]?.title).toBe("x".repeat(200));
});

test("a title sequence a chunk cut in two gives its title to the chunk that ends it, wherever the cut fell", () => {
  const whole = "colour \x1b[31mred\x1b[0m \x1b]0;my-title\x07 then more \x1b]2;other\x1b\\";
  for (let cut = 0; cut <= whole.length; cut++) {
    const first = readTitle("", whole.slice(0, cut));
    const second = readTitle(first.carry, whole.slice(cut));
    expect(second.title ?? first.title).toBe("other");
  }
});

test("the start of no title's sequence is not carried, and no runaway one is carried past its length", () => {
  expect(readTitle("", "colour \x1b[31m").carry).toBe("");
  expect(readTitle("", `\x1b]0;${"x".repeat(5_000)}`).carry).toBe("");
  expect(readTitle("", `\x1b]0;${"x".repeat(5_000)}\x07`).title).toBe("x".repeat(5_000));
});

// ConPTY gives the host something other than the two pieces the program wrote: at windows-latest
// no title formed from them at all, so there is nothing for the host's carry to join there.
// Every cut through a title sequence is still tested on every platform by the readTitle test.
test.skipIf(process.platform === "win32")("a title a program writes in two pieces arrives as one title", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const { terminalId } = terminals.open("c1", 80, 24);
  typing(terminalId, stoppingThePromptsTitle + shell.runningBun("process.stdout.write('\\x1b]0;half-'); setTimeout(() => process.stdout.write('title\\x07'), 300)"));
  const [tab] = await tabsOnceSettled(browser.received, ([only]) => only?.terminals[0]?.title === "half-title");
  expect(tab?.terminals[0]?.title).toBe("half-title");
});

test("a terminal splits beside or below itself, and the others close up when one exits", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const left = terminals.open("c1", 80, 24);
  const right = terminals.open("c1", 80, 24, beside(left.terminalId));
  const belowRight = terminals.open("c1", 80, 24, below(right.terminalId));
  const [tab] = lastTabs(browser.received)!;
  expect(tab?.layout).toEqual({
    axis: "columns",
    children: [{ terminalId: left.terminalId }, { axis: "rows", children: [{ terminalId: right.terminalId }, { terminalId: belowRight.terminalId }] }],
  });
  expect(tab?.terminals.map(({ id }) => id)).toEqual([left.terminalId, right.terminalId, belowRight.terminalId]);

  terminals.close(right.terminalId);
  const [closedUp] = await tabsOnceSettled(browser.received, ([only]) => only?.terminals.length === 2);
  expect(closedUp?.layout).toEqual({ axis: "columns", children: [{ terminalId: left.terminalId }, { terminalId: belowRight.terminalId }] });
});

test.skipIf(process.platform === "win32")("closing unless busy closes a terminal at its prompt, and keeps one running a command, naming it", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const idle = terminals.open("c1", 80, 24);
  const working = terminals.open("c1", 80, 24, beside(idle.terminalId));
  typing(working.terminalId, "echo started; sleep 30");
  await outputContaining(browser.received, "started\r\n");
  await Bun.sleep(200);

  await terminals.closeUnlessBusy(browser.socket, working.terminalId);
  expect(browser.received.findLast((message) => message.type === "terminal.busy")).toEqual({ type: "terminal.busy", terminalId: working.terminalId, command: "sleep" });
  await terminals.closeUnlessBusy(browser.socket, idle.terminalId);
  const [left] = await tabsOnceSettled(browser.received, ([only]) => only?.terminals.length === 1);
  expect(left?.terminals.map(({ id }) => id)).toEqual([working.terminalId]);
});

test("closing a tab unless busy closes it when every shell sits at its prompt, and otherwise names what runs and keeps it", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const idle = terminals.open("c1", 80, 24);
  const working = terminals.open("c1", 80, 24);
  const split = terminals.open("c1", 80, 24, beside(working.terminalId));
  typing(split.terminalId, shell.runningBun("console.log('started'); setTimeout(() => {}, 30000)"));
  await outputContaining(browser.received, "started\r\n");
  await Bun.sleep(200);

  await terminals.closeTabUnlessBusy(browser.socket, working.tabId);
  expect(browser.received.findLast((message) => message.type === "terminal.busy")).toEqual({
    type: "terminal.busy",
    terminalId: split.terminalId,
    command: "bun",
    tabId: working.tabId,
  });
  await terminals.closeTabUnlessBusy(browser.socket, idle.tabId);
  const left = await tabsOnceSettled(browser.received, (tabs) => tabs.length === 1);
  expect(left.map(({ id }) => id)).toEqual([working.tabId]);
});

test("a program with a key runs once: opening it again while it runs shows its terminal, and after it ends starts it anew", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const follow = { tabName: "follow", key: "follow job", command: waitingForALine };
  const first = terminals.openProgram("c1", 80, 24, follow);
  const again = terminals.openProgram("c1", 80, 24, follow);
  expect({ tabId: again.tabId, terminalId: again.terminalId }).toEqual({ tabId: first.tabId, terminalId: first.terminalId });
  const unkeyed = terminals.openProgram("c1", 80, 24, { tabName: "follow", command: waitingForALine });
  expect(lastTabs(browser.received)?.map(({ id }) => id)).toEqual([first.tabId, unkeyed.tabId]);

  typing(first.terminalId, "");
  await first.exited;
  const afterEnding = terminals.openProgram("c1", 80, 24, follow);
  expect(afterEnding.terminalId).not.toBe(first.terminalId);
});

test("shutting down waits for every shell to exit, so a host that re-executes itself leaves no zombie behind", async () => {
  const watching = fakeBrowser();
  terminals.attach(watching.socket, "c1");
  [terminals.open("c1", 80, 24), terminals.open("c1", 80, 24)].forEach(({ terminalId }) => typing(terminalId, `echo shell-${shell.pid}-up`));
  const shellsUp = () => new Set(outputOf(watching.received).match(/shell-\d+-up/g));
  const pids = [...(await eventually(shellsUp, (up) => up.size === 2))].map((up) => Number(up.split("-")[1]));
  expect(pids).toHaveLength(2);

  await terminals.shutdown();

  expect(pids.filter(isRunning)).toEqual([]);
});

test("two conversations of a workspace have tabs of their own, and closing one conversation's terminals leaves the other's running", async () => {
  const first = fakeBrowser();
  const second = fakeBrowser();
  terminals.attach(first.socket, "c1");
  terminals.attach(second.socket, "c2");
  const ofFirst = terminals.open("c1", 80, 24);
  const ofSecond = terminals.open("c2", 80, 24);
  expect(lastTabs(first.received)?.map(({ id }) => id)).toEqual([ofFirst.tabId]);
  expect(lastTabs(second.received)?.map(({ id }) => id)).toEqual([ofSecond.tabId]);

  terminals.closeConversation("c1");
  expect(await tabsOnceSettled(first.received, (tabs) => tabs.length === 0)).toEqual([]);
  typing(ofSecond.terminalId, "echo still-$((40+2))");
  expect(await outputContaining(second.received, "still-42")).toContain("still-42");
  expect(lastTabs(second.received)?.map(({ id }) => id)).toEqual([ofSecond.tabId]);
});

test("after a restart, a conversation's tabs and splits come back with new shells, under what the old shells showed", async () => {
  const before = fakeBrowser();
  terminals.attach(before.socket, "c1");
  const first = terminals.open("c1", 80, 24);
  terminals.open("c1", 80, 24, below(first.terminalId));
  const second = terminals.open("c1", 80, 24);
  typing(first.terminalId, `echo before-$((1+1))-shell-${shell.pid}`);
  const oldShell = await eventually(() => outputOf(before.received).match(/before-2-shell-(\d+)/)?.[1], (pid) => pid !== undefined);
  expect(oldShell).toBeDefined();
  const tabsBefore = lastTabs(before.received)!;

  await restartHost();
  const after = fakeBrowser();
  terminals.attach(after.socket, "c1");
  expect(lastTabs(after.received)).toEqual(tabsBefore.map((tab) => ({ ...tab, terminals: tab.terminals.map(({ id }) => ({ id, title: null })) })));
  expect(lastTabs(after.received)!.map(({ id }) => id)).toEqual([first.tabId, second.tabId]);

  terminals.replay(after.socket, first.terminalId);
  const history = replayed(after.received, first.terminalId);
  expect(history).toContain("before-2");
  expect(history.indexOf(RESTARTED_NOTE)).toBeGreaterThan(history.lastIndexOf("before-2"));
  typing(first.terminalId, `echo after-$((1+1))-shell-${shell.pid}`);
  const newShell = await eventually(() => outputOf(after.received).match(/after-2-shell-(\d+)/)?.[1], (pid) => pid !== undefined);
  expect(newShell).toBeDefined();
  expect(newShell).not.toBe(oldShell);
}, 15_000);

test("a full scrollback kept over a restart loses only its oldest lines to the new shell's output", async () => {
  const before = fakeBrowser();
  terminals.attach(before.socket, "c1");
  const { terminalId } = terminals.open("c1", 80, 24);
  typing(terminalId, `${shell.runningBun("for (let i = 0; i < 4000; i++) console.log('line-' + i + ' ' + '0'.repeat(80))")}; echo filled-$((2*3))`);
  await eventually(() => outputOf(before.received), (output) => output.includes("filled-6"), 20_000);

  await restartHost();
  const after = fakeBrowser();
  terminals.attach(after.socket, "c1");
  typing(terminalId, "echo after-$((5+5))");
  await outputContaining(after.received, "after-10");
  terminals.replay(after.socket, terminalId);
  const history = replayed(after.received, terminalId);
  expect(history).toContain("line-3999");
  expect(history).toContain(RESTARTED_NOTE);
  expect(history).toContain("after-10");
}, 30_000);

test("a program's tab, a closed tab and a closed split are not there after a restart", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const kept = terminals.open("c1", 80, 24);
  const closedSplit = terminals.open("c1", 80, 24, beside(kept.terminalId));
  terminals.openProgram("c1", 80, 24, { tabName: "follow", command: waitingForALine });
  const closedTab = terminals.open("c1", 80, 24);
  terminals.close(closedSplit.terminalId);
  terminals.closeTab(closedTab.tabId);
  await tabsOnceSettled(browser.received, (tabs) => tabs.length === 2 && tabs[0]!.terminals.length === 1);

  await restartHost();
  const after = fakeBrowser();
  terminals.attach(after.socket, "c1");
  expect(lastTabs(after.received)).toEqual([{ id: kept.tabId, name: shell.name, layout: { terminalId: kept.terminalId }, terminals: [{ id: kept.terminalId, title: null }] }]);
});

test("a terminal's output is not saved before the save delay, and is saved when the host stops", async () => {
  terminals = new TerminalService(hub, store, 60_000);
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const { terminalId } = terminals.open("c1", 80, 24);
  typing(terminalId, "echo pending-$((4*4))");
  await outputContaining(browser.received, "pending-16");
  expect(savedOutputOf(terminalId)).not.toContain("pending-16");

  await terminals.shutdown();
  expect(savedOutputOf(terminalId)).toContain("pending-16");
});

test("clearing a terminal clears its saved output at once, and deleting the conversation forgets its tabs", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const { terminalId } = terminals.open("c1", 80, 24);
  typing(terminalId, "echo secret-$((3*3))");
  const savedOutput = () => store.listTerminalTabs("c1")[0]?.scrollback.get(terminalId) ?? "";
  expect(await eventually(savedOutput, (saved) => saved.includes("secret-9"))).toContain("secret-9");

  terminals.clear(terminalId);
  expect(savedOutput()).not.toContain("secret-9");

  terminals.closeConversation("c1");
  store.deleteConversation("c1");
  expect(store.listTerminalTabs("c1")).toEqual([]);
  expect(await tabsOnceSettled(browser.received, (tabs) => tabs.length === 0)).toEqual([]);
});

test("opening a terminal for a conversation that no longer exists fails", () => {
  expect(() => terminals.open("gone", 80, 24)).toThrow("This conversation no longer exists.");
});

test("closing a program's terminal ends what the program started too", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const startingAnother = "const child = Bun.spawn([process.execPath, '-e', 'setTimeout(() => {}, 1000000)']); console.log('started-' + child.pid); await child.exited";
  const program = terminals.openProgram("c1", 80, 24, { tabName: "login", command: [process.execPath, "-e", startingAnother] });
  const started = await eventually(() => outputOf(browser.received).match(/started-(\d+)/)?.[1], (pid) => pid !== undefined);
  expect(started).toBeDefined();
  terminals.close(program.terminalId);
  await program.exited;
  expect(await eventually(() => isRunning(Number(started)), (running) => !running)).toBe(false);
});

/** Windows has no hangup: closing a terminal there kills it at once with everything it started. */
test.skipIf(process.platform === "win32")("a program that ignores the hangup is killed after a grace period, with what it started, so its terminal still closes", async () => {
  const browser = fakeBrowser();
  terminals.attach(browser.socket, "c1");
  const command = ["/bin/sh", "-c", "trap '' HUP; echo ignoring-$$; while :; do sleep 1000; done"];
  const program = terminals.openProgram("c1", 80, 24, { tabName: "stubborn", command });
  const group = Number((await eventually(() => outputOf(browser.received).match(/ignoring-(\d+)/)?.[1], (pid) => pid !== undefined))!);
  terminals.close(program.terminalId);
  const ended = await Promise.race([program.exited.then(() => "ended"), Bun.sleep(8_000).then(() => "still running")]);
  expect(ended).toBe("ended");
  expect(await eventually(() => isRunning(-group), (running) => !running)).toBe(false);
}, 15_000);
