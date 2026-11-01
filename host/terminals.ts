import type { Subprocess } from "bun";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { MAX_TERMINALS_PER_TAB, type TerminalTab } from "../shared/model.ts";
import type { ServerMessage, TerminalSplit } from "../shared/protocol.ts";
import { splitTerminal, terminalsIn, withoutTerminal, type TerminalLayout } from "../shared/terminal-layout.ts";
import { agentEnvironment, loginShell } from "./acp/environment.ts";
import { isConsoleTitleOf, programName, terminalShell } from "./command-shell.ts";
import { hostEnvironment } from "./current-path.ts";
import type { BrowserSocket, Hub } from "./hub.ts";
import type { Store } from "./store.ts";
import { TrimmedOutput } from "./trimmed-output.ts";
import { childProgramNames, killProcessTree } from "./windows-processes.ts";
import { HostProblemError } from "../shared/host-problems.ts";

const SCROLLBACK_CHARACTERS = 256 * 1024;
const SCROLLBACK_SAVE_DELAY_MS = 15_000;
/** A restarted shell's size until a window fits it to its pane. */
const RESTARTED_SIZE = { columns: 80, rows: 24 };
/** Every listing of a conversation's terminals carries the titles, so a runaway one is cut short. */
const TITLE_CHARACTERS = 200;
const HANGUP_GRACE_MS = 3000;
const MAX_DIMENSION = 1_000;

const titleSequence = /\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

const alternateScreenSwitch = /\x1b\[\?(1049|1047|47)([hl])/g;

/**
 * Leaves the alternate screen a full-screen program left the old output in, the way the program went in, so the cursor
 * comes back to where it was before. Leaving when not in it would move the cursor, onto the old output.
 */
function alternateScreenLeft(text: string) {
  const [, mode, setOrReset] = [...text.matchAll(alternateScreenSwitch)].at(-1) ?? [];
  return setOrReset === "h" ? `\x1b[?${mode}l` : "";
}

/**
 * Ends what else the old output left switched on, without wiping it as a full reset would: mouse reporting, bracketed
 * paste, application cursor keys, colours and a hidden cursor.
 */
const LEFTOVER_MODES_RESET = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?1l\x1b[0m\x1b[?25h";
export const RESTARTED_NOTE = "A new shell: the one above ended when Mirador stopped.";
/** CAN cancels an escape sequence the old output was cut off in. */
const restartedScrollback = (saved: string) =>
  `${saved}\x18${alternateScreenLeft(saved)}${LEFTOVER_MODES_RESET}\r\n\x1b[2m${RESTARTED_NOTE}\x1b[0m\r\n`;

/** Kept apart, so the oldest lines go first once new output fills the scrollback, as live output's chunks do. */
const linesOf = (text: string) => text.split(/(?<=\n)/);

interface Shell {
  id: string;
  conversationId: string;
  tabId: string;
  child: Subprocess;
  scrollback: string[];
  scrollbackLength: number;
  trimmed: TrimmedOutput;
  title: string | null;
  titleCarry: string;
  program: string;
  programKey: string | undefined;
  saved: boolean;
}

/** What reattaching windows are sent, and the store keeps: the scrollback, led by what its trimmed output left it needing. */
const replayedOutput = (shell: Shell) => shell.trimmed.lead + shell.scrollback.join("");

/** A program to run in a terminal tab of its own instead of the login shell; without an environment, it gets the shell's. */
export interface TerminalProgram {
  tabName: string;
  command: string[];
  environment?: Record<string, string>;
  /** While a program with the same key runs in the conversation's terminals, opening this one shows that one instead. */
  key?: string;
}

interface Tab {
  id: string;
  conversationId: string;
  name: string;
  /** Null only until its first terminal starts. */
  layout: TerminalLayout | null;
  /** A program's tab is not: it ends for good when the host stops. */
  saved: boolean;
}

interface ShellStart {
  program?: TerminalProgram;
  /** A shell started again after the host stopped keeps the id its terminal has in the saved layout. */
  restarting?: { terminalId: string; scrollback: string };
}

const terminalIdsOf = (tab: Tab) => (tab.layout ? terminalsIn(tab.layout) : []);

const dimension = (value: number) => Math.min(Math.max(1, Math.floor(value) || 1), MAX_DIMENSION);

/** The start of a title sequence a chunk cut in two, at the text's end; the chunk after it brings the rest.
 * An escape that cannot grow into a title — a colour, a cursor move — is no title's start, so nothing of it is carried. */
const unfinishedTitle = /\x1b(?:\])?(?:[02](?:;[^\x07\x1b]*)?)?(?:\x1b)?$/;
const MAX_UNFINISHED_TITLE = 4096;

/** The title the PTY output sets, with the start of a sequence it cut short kept as the carry for the next chunk. */
export function readTitle(carry: string, chunk: string): { title: string | undefined; carry: string } {
  const reading = carry + chunk;
  const titles = [...reading.matchAll(titleSequence)];
  const latest = titles.at(-1);
  const open = unfinishedTitle.exec(reading.slice(latest ? latest.index + latest[0].length : 0))?.[0] ?? "";
  return { title: latest?.[1], carry: open.length <= MAX_UNFINISHED_TITLE ? open : "" };
}

const isRunning = (child: Subprocess) => child.exitCode === null && child.signalCode === null;

/** The shell leads its terminal's session, so its process group is the one it started in; it may have exited just now. */
function killGroupOf(child: Subprocess) {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {}
}

/**
 * What runs in the foreground of the shell's terminal, or null while the shell itself waits at its prompt: the
 * terminal's foreground process group is then the shell's own. Windows has no such group, so there it is the first
 * program the shell started that still runs.
 */
async function foregroundCommand(shellPid: number): Promise<string | null> {
  if (process.platform === "win32") return childProgramNames(shellPid)[0] ?? null;
  const groups = Bun.spawn(["ps", "-o", "tpgid=,pgid=", "-p", String(shellPid)], { stdout: "pipe", stderr: "ignore" });
  const [foregroundGroup, shellGroup] = (await new Response(groups.stdout).text()).trim().split(/\s+/);
  if (!foregroundGroup || foregroundGroup === shellGroup || Number(foregroundGroup) <= 0) return null;
  const command = Bun.spawn(["ps", "-o", "comm=", "-p", foregroundGroup], { stdout: "pipe", stderr: "ignore" });
  return basename((await new Response(command.stdout).text()).trim()) || "a command";
}

/**
 * Login shells on pseudo-terminals, each conversation's own, started in its workspace's folder and grouped into tabs of
 * splits, side by side and one above the other. They keep running while another conversation is shown.
 * They live in the host, so every window shows the same tabs and reloading the page reattaches to them (the recent
 * output is replayed). Their output is never logged, but the store keeps it with the tabs and splits: shells end when
 * the host stops, and the next run starts new ones in their place, under what the old ones showed.
 */
export class TerminalService {
  private readonly shells = new Map<string, Shell>();
  private readonly tabs = new Map<string, Tab>();
  private readonly restartedConversations = new Set<string>();
  private readonly unsavedScrollback = new Set<Shell>();
  private scrollbackSave: ReturnType<typeof setTimeout> | undefined;
  private stopping = false;

  constructor(
    private readonly hub: Hub,
    private readonly store: Store,
    private readonly scrollbackSaveDelayMs = SCROLLBACK_SAVE_DELAY_MS,
  ) {}

  attach(socket: BrowserSocket, conversationId: string | null) {
    socket.data.terminalConversationId = conversationId;
    if (!conversationId) return;
    this.restartSavedTabs(conversationId);
    this.hub.send(socket, this.listing(conversationId));
  }

  replay(socket: BrowserSocket, terminalId: string) {
    const shell = this.shells.get(terminalId);
    if (shell) this.hub.send(socket, { type: "terminal.replayed", terminalId, data: replayedOutput(shell) });
  }

  /** Starts a shell in a new tab, or beside or below the terminal `split` names. */
  open(conversationId: string, columns: number, rows: number, split: TerminalSplit | null = null) {
    const cwd = this.existingFolderOf(conversationId);
    this.restartSavedTabs(conversationId);
    const tab = split ? this.splittableTabOf(split.terminalId) : this.newTab(conversationId);
    const shell = this.spawn(tab, cwd, columns, rows);
    tab.layout = split && tab.layout ? splitTerminal(tab.layout, split.terminalId, shell.id, split.axis) : { terminalId: shell.id };
    this.tabs.set(tab.id, tab);
    if (tab.saved) this.saveOpened(tab, shell.id, split === null);
    this.publishListing(conversationId);
    return { tabId: tab.id, terminalId: shell.id };
  }

  /** Runs `program` in a new tab, which closes when it exits, unless the program's key says it already runs. */
  openProgram(conversationId: string, columns: number, rows: number, program: TerminalProgram) {
    const running = program.key === undefined ? undefined : this.shellsIn(conversationId).find(({ programKey }) => programKey === program.key);
    if (running) return { tabId: running.tabId, terminalId: running.id, exited: running.child.exited };
    const cwd = this.existingFolderOf(conversationId);
    this.restartSavedTabs(conversationId);
    const tab = this.newTab(conversationId, program);
    const shell = this.spawn(tab, cwd, columns, rows, { program });
    tab.layout = { terminalId: shell.id };
    this.tabs.set(tab.id, tab);
    this.publishListing(conversationId);
    return { tabId: tab.id, terminalId: shell.id, exited: shell.child.exited };
  }

  input(terminalId: string, data: string) {
    this.shells.get(terminalId)?.child.terminal?.write(data);
  }

  resize(terminalId: string, columns: number, rows: number) {
    this.shells.get(terminalId)?.child.terminal?.resize(dimension(columns), dimension(rows));
  }

  /** Forgets the output above the cursor's line, in every window and in what a reload replays, like ⌘K in a macOS terminal. */
  clear(terminalId: string) {
    const shell = this.shells.get(terminalId);
    if (!shell) return;
    const output = shell.scrollback.join("");
    const cursorLine = output.split("\n").at(-1) ?? "";
    shell.trimmed.read(output.slice(0, output.length - cursorLine.length));
    shell.scrollback = [cursorLine];
    shell.scrollbackLength = cursorLine.length;
    if (shell.saved) this.saveScrollbackNow(shell);
    this.publish(shell.conversationId, { type: "terminal.cleared", terminalId });
  }

  /**
   * A shell that ignores the hangup is killed after a grace period, with its process group: what runs in it most likely
   * ignores the hangup the kernel sends it once the shell is gone, too. Windows has neither, so there it is killed at
   * once with everything it started.
   */
  async close(terminalId: string) {
    const child = this.shells.get(terminalId)?.child;
    if (!child) return;
    if (process.platform === "win32") return void (await killProcessTree(child.pid));
    child.kill("SIGHUP");
    setTimeout(() => isRunning(child) && killGroupOf(child), HANGUP_GRACE_MS).unref();
  }

  /** Like iTerm2's ⌘W: a terminal at its shell's prompt closes, one running a command stays and the command is named. */
  async closeUnlessBusy(socket: BrowserSocket, terminalId: string) {
    const shell = this.shells.get(terminalId);
    if (!shell) return;
    const command = await foregroundCommand(shell.child.pid);
    if (command === null) this.close(terminalId);
    else this.hub.send(socket, { type: "terminal.busy", terminalId, command });
  }

  closeTab(tabId: string) {
    const tab = this.tabs.get(tabId);
    if (tab) terminalIdsOf(tab).forEach((terminalId) => this.close(terminalId));
  }

  /** The tab closes when every shell in it sits at its prompt; otherwise it stays, and the first command running is named. */
  async closeTabUnlessBusy(socket: BrowserSocket, tabId: string) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const shells = terminalIdsOf(tab).flatMap((terminalId) => this.shells.get(terminalId) ?? []);
    const commands = await Promise.all(shells.map(async (shell) => ({ shell, command: await foregroundCommand(shell.child.pid) })));
    const [running] = commands.flatMap(({ shell, command }) => (command === null ? [] : [{ terminalId: shell.id, command }]));
    if (running) this.hub.send(socket, { type: "terminal.busy", ...running, tabId });
    else this.closeTab(tabId);
  }

  closeConversation(conversationId: string) {
    this.shellsIn(conversationId).forEach(({ id }) => this.close(id));
  }

  /**
   * Saves what every terminal shows, then waits for the shells to exit: one still running when the host re-executes
   * itself would be left a zombie. Their tabs stay saved for the next run.
   */
  async shutdown() {
    this.stopping = true;
    this.saveScrollback();
    const exits = [...this.shells.values()].map(({ child }) => child.exited);
    const closes = [...this.shells.values()].map(({ id }) => this.close(id));
    await Promise.all([...exits, ...closes]);
  }

  private folderOf(conversationId: string) {
    const conversation = this.store.findConversation(conversationId);
    return conversation && this.store.findWorkspace(conversation.workspaceId)?.path;
  }

  private existingFolderOf(conversationId: string) {
    const folder = this.folderOf(conversationId);
    if (!folder) throw new HostProblemError({ code: "conversation-gone" });
    return folder;
  }

  /**
   * Once a host run, before the conversation's terminals are first listed or added to: the tabs the last run left, each
   * terminal with a new shell under what the old one showed. A folder that is gone leaves them saved for later.
   */
  private restartSavedTabs(conversationId: string) {
    if (this.restartedConversations.has(conversationId)) return;
    this.restartedConversations.add(conversationId);
    const cwd = this.folderOf(conversationId);
    if (!cwd || !existsSync(cwd)) return;
    this.store.listTerminalTabs(conversationId).forEach(({ id, name, layout, scrollback }) => {
      const tab: Tab = { id, conversationId, name, layout, saved: true };
      this.tabs.set(id, tab);
      terminalsIn(layout).forEach((terminalId) =>
        this.spawn(tab, cwd, RESTARTED_SIZE.columns, RESTARTED_SIZE.rows, {
          restarting: { terminalId, scrollback: restartedScrollback(scrollback.get(terminalId) ?? "") },
        }),
      );
    });
  }

  private saveOpened(tab: Tab, terminalId: string, inNewTab: boolean) {
    if (inNewTab) this.store.addTerminalTab(tab.conversationId, { id: tab.id, name: tab.name, layout: tab.layout! });
    else this.store.setTerminalTabLayout(tab.id, tab.layout!);
    this.store.addTerminalScrollback(tab.id, terminalId);
  }

  private saveClosed(tab: Tab, terminalId: string) {
    if (tab.layout === null) return this.store.deleteTerminalTab(tab.id);
    this.store.setTerminalTabLayout(tab.id, tab.layout);
    this.store.deleteTerminalScrollback(terminalId);
  }

  private scrollbackChanged(shell: Shell) {
    this.unsavedScrollback.add(shell);
    this.scrollbackSave ??= setTimeout(() => this.saveScrollback(), this.scrollbackSaveDelayMs);
  }

  private saveScrollback() {
    clearTimeout(this.scrollbackSave);
    this.scrollbackSave = undefined;
    this.unsavedScrollback.forEach((shell) => this.store.setTerminalScrollback(shell.id, replayedOutput(shell)));
    this.unsavedScrollback.clear();
  }

  private saveScrollbackNow(shell: Shell) {
    this.unsavedScrollback.delete(shell);
    this.store.setTerminalScrollback(shell.id, replayedOutput(shell));
  }

  private splittableTabOf(terminalId: string) {
    const tab = this.tabs.get(this.shells.get(terminalId)?.tabId ?? "");
    if (!tab) throw new HostProblemError({ code: "terminal-closed" });
    if (terminalIdsOf(tab).length >= MAX_TERMINALS_PER_TAB) throw new HostProblemError({ code: "tab-terminal-limit", count: MAX_TERMINALS_PER_TAB });
    return tab;
  }

  /** Named after the shell (or the program), numbered from 2 with the lowest number no open tab uses: zsh, zsh 2, zsh 3… */
  private newTab(conversationId: string, program?: TerminalProgram): Tab {
    const baseName = program?.tabName ?? programName(terminalShell(loginShell, agentEnvironment(hostEnvironment()))[0]!);
    const taken = new Set(this.tabsIn(conversationId).map(({ name }) => name));
    const numbered = (number: number) => (number === 1 ? baseName : `${baseName} ${number}`);
    let number = 1;
    while (taken.has(numbered(number))) number++;
    return { id: crypto.randomUUID(), conversationId, name: numbered(number), layout: null, saved: program === undefined };
  }

  private spawn(tab: Tab, cwd: string, columns: number, rows: number, { program, restarting }: ShellStart = {}) {
    const decoder = new TextDecoder();
    const environment = program?.environment ?? agentEnvironment(hostEnvironment());
    const command = program?.command ?? terminalShell(loginShell, environment);
    const shell: Shell = {
      id: restarting?.terminalId ?? crypto.randomUUID(),
      conversationId: tab.conversationId,
      tabId: tab.id,
      child: undefined!,
      scrollback: restarting ? linesOf(restarting.scrollback) : [],
      scrollbackLength: restarting?.scrollback.length ?? 0,
      trimmed: new TrimmedOutput(),
      title: null,
      titleCarry: "",
      program: command[0]!,
      programKey: program?.key,
      saved: tab.saved,
    };
    shell.child = Bun.spawn(command, {
      cwd,
      env: { ...environment, TERM: "xterm-256color", COLORTERM: "truecolor" },
      terminal: {
        cols: dimension(columns),
        rows: dimension(rows),
        data: (_terminal, bytes) => this.received(shell, decoder.decode(bytes, { stream: true })),
      },
    });
    this.shells.set(shell.id, shell);
    shell.child.exited.then((exitCode) => this.ended(shell, exitCode));
    return shell;
  }

  private received(shell: Shell, text: string) {
    if (!text) return;
    shell.scrollback.push(text);
    shell.scrollbackLength += text.length;
    while (shell.scrollbackLength > SCROLLBACK_CHARACTERS && shell.scrollback.length > 1) {
      const oldest = shell.scrollback.shift()!;
      shell.scrollbackLength -= oldest.length;
      shell.trimmed.read(oldest);
    }
    if (shell.saved && !this.stopping) this.scrollbackChanged(shell);
    this.publish(shell.conversationId, { type: "terminal.output", terminalId: shell.id, data: text });
    const read = readTitle(shell.titleCarry, text);
    shell.titleCarry = read.carry;
    this.retitle(shell, read.title);
  }

  private retitle(shell: Shell, title: string | undefined) {
    if (title === undefined) return;
    const kept = isConsoleTitleOf(shell.program, title) ? null : title.slice(0, TITLE_CHARACTERS) || null;
    if (kept === shell.title) return;
    shell.title = kept;
    this.publishListing(shell.conversationId);
  }

  private ended(shell: Shell, exitCode: number) {
    shell.child.terminal?.close();
    this.shells.delete(shell.id);
    this.unsavedScrollback.delete(shell);
    this.removeFromTab(shell);
    this.publish(shell.conversationId, { type: "terminal.exited", terminalId: shell.id, exitCode });
    this.publishListing(shell.conversationId);
  }

  private removeFromTab(shell: Shell) {
    const tab = this.tabs.get(shell.tabId);
    if (!tab?.layout) return;
    tab.layout = withoutTerminal(tab.layout, shell.id);
    if (tab.layout === null) this.tabs.delete(tab.id);
    if (tab.saved && !this.stopping) this.saveClosed(tab, shell.id);
  }

  private shellsIn(conversationId: string) {
    return [...this.shells.values()].filter((shell) => shell.conversationId === conversationId);
  }

  private tabsIn(conversationId: string) {
    return [...this.tabs.values()].filter((tab) => tab.conversationId === conversationId);
  }

  private listing(conversationId: string): ServerMessage {
    const tabs: TerminalTab[] = this.tabsIn(conversationId).flatMap((tab) =>
      tab.layout
        ? [{ id: tab.id, name: tab.name, layout: tab.layout, terminals: terminalIdsOf(tab).map((terminalId) => ({ id: terminalId, title: this.shells.get(terminalId)?.title ?? null })) }]
        : [],
    );
    return { type: "terminals.listed", conversationId, tabs };
  }

  private publishListing(conversationId: string) {
    this.publish(conversationId, this.listing(conversationId));
  }

  private publish(conversationId: string, message: ServerMessage) {
    this.hub.publishWhere((socket) => socket.data.terminalConversationId === conversationId, message);
  }
}
