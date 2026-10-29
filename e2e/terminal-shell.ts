import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { findPowerShell, programName } from "../host/command-shell.ts";
import { foldersOnPath, programIn } from "./test-host.ts";

/**
 * What specs type into a terminal tab, in the language of the shell it runs: sh, or on Windows PowerShell, which a tab
 * runs there whatever SHELL says. The PowerShell lines run in Windows PowerShell 5.1 as in pwsh 7, so they write ESC as
 * [char]27 and join commands with ; only.
 */
const onWindows = process.platform === "win32";

/** A tab is named after its shell: the specs' sh, or the PowerShell the host finds on Windows. */
export const shellTabName = onWindows ? programName(findPowerShell(process.env, (name) => programIn(foldersOnPath(), name) ?? null)) : "sh";

/** `expression` worked out by the shell, so the line typed never shows what it prints. */
export const sum = (expression: string) => (onWindows ? `$(${expression})` : `$((${expression}))`);

export const echo = (text: string) => (onWindows ? `echo "${text}"` : `echo ${text}`);

export const setVariable = (name: string, value: string) => (onWindows ? `$${name}='${value}'` : `${name}=${value}`);

export const variableOr = (name: string, fallback: string) => (onWindows ? `$(if ($${name}) { $${name} } else { '${fallback}' })` : `\${${name}:-${fallback}}`);

export const shellPid = onWindows ? "$PID" : "$$";

/** Shows in the prompt of a shell waiting for a command. */
export const promptMark = onWindows ? "PS " : "$";

export const countTo = (last: number) => (onWindows ? `1..${last}` : `seq 1 ${last}`);

/** Prints `label-1` through `label-<count>` to the terminal, one on each line. */
export const printLinesTo = (count: number, label: string) =>
  onWindows ? `${countTo(count)} | ForEach-Object { echo "${label}-$_" }` : `for i in $(${countTo(count)}); do echo "${label}-$i"; done`;

/** Prints `text`, control characters and all, with no line break after it. */
export function printRaw(text: string) {
  if (!onWindows) return `printf '${[...text].map((character) => posixPrintfEscapes[character] ?? character).join("")}'`;
  const quoted = [...text].map((character) => (character < " " ? `$([char]${character.charCodeAt(0)})` : (powershellEscapes[character] ?? character)));
  return `[Console]::Write("${quoted.join("")}")`;
}

const posixPrintfEscapes: Record<string, string> = { "\x1b": "\\033", "\x07": "\\007", "\n": "\\n", "\\": "\\\\", "%": "%%" };
const powershellEscapes: Record<string, string> = { '"': '`"', $: "`$", "`": "``" };

/**
 * Prints `ready` on a line of its own, then shows the keys the terminal sends, as `cat -v` does, until Ctrl+C. Windows
 * has no cat -v, and its console turns the terminal's escape sequences into key presses unless asked for them as they
 * are, so there a Bun program asks, and prints `ready` only once it has: keys sent while Bun starts would be lost.
 */
export const showKeys = (ready: string) => (onWindows ? `bun "${join(import.meta.dirname, "show-keys.ts")}" ${ready}` : `${echo(ready)}; cat -v`);

/** Asks the terminal to report the mouse, as SGR, then shows what it sends; on Windows show-keys asks, as only it can. */
export const showKeysFollowingTheMouse = (ready: string) =>
  onWindows ? `${showKeys(ready)} --follow-mouse` : `${printRaw("\x1b[?1000h\x1b[?1006h")}; ${showKeys(ready)}`;

/** The name the host gives the command keepShellBusy runs. */
export const busyCommandName = "bun";

/**
 * Types a command that keeps the shell busy for 30 s, and waits until it prints, so it is running: a loaded machine can
 * take a moment to start it. Bun waits rather than sleep, which PowerShell runs inside the shell, where the host sees
 * no command running.
 */
export async function keepShellBusy(page: Page, screen: Locator) {
  await page.keyboard.type("bun -e 'console.log(`busy-${6 * 7}`); setTimeout(() => {}, 30000)'\n");
  await expect(screen).toContainText("busy-42");
}
