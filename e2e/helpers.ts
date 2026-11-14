import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { expect, test, type Frame, type FrameLocator, type Locator, type Page } from "@playwright/test";
import type { TestHost } from "./test-host.ts";

/** A path as the agent's Bash takes it: Git Bash reads a backslash as an escape, so on Windows the path is written with slashes. */
export const bashPath = (path: string) => path.replaceAll("\\", "/");

/** Presses on the item and moves to just inside the top or bottom edge of the target, leaving the button down. */
export async function dragOnto(page: Page, item: Locator, target: Locator, edge: "top" | "bottom") {
  const from = (await item.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, edge === "top" ? to.y + 3 : to.y + to.height - 3, { steps: 10 });
}

/** Listens to the host the way the desktop app does, printing a line per event; it ends with this process, as its stdin closes. */
export const startDesktopNotifier = (origin: string, token: string, builtFromCode?: string) =>
  spawn("bun", ["e2e/desktop-notifier.ts", origin, token, ...(builtFromCode === undefined ? [] : [builtFromCode])], { stdio: ["pipe", "pipe", "inherit"] });

async function canvasRequest(host: TestHost, conversationId: string, method: string, params: Record<string, unknown>) {
  const response = await fetch(`${host.origin}/mcp/${conversationId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${host.mcpToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.text();
  const payload = body
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  return JSON.parse(payload ?? body);
}

export async function callCanvasTool(host: TestHost, conversationId: string, name: string, args: Record<string, unknown>) {
  const message = await canvasRequest(host, conversationId, "tools/call", { name, arguments: args });
  return message.result.content[0].text as string;
}

/** The tools the canvas server lists for the conversation's agent, by name. */
export async function canvasToolNames(host: TestHost, conversationId: string) {
  const message = await canvasRequest(host, conversationId, "tools/list", {});
  return (message.result.tools as { name: string }[]).map(({ name }) => name);
}

/**
 * Waits for a canvas frame and the page around it to paint twice. The sandboxed frame runs in a process of its own, and
 * the browser sends it a click by what it last painted: a click right after its content first draws can go nowhere.
 */
export async function untilFramePainted(page: Page, iframe: Locator) {
  const twoFramesPainted = () => new Promise((painted) => requestAnimationFrame(() => requestAnimationFrame(painted)));
  const frame = await (await iframe.elementHandle())?.contentFrame();
  await frame?.evaluate(twoFramesPainted);
  await page.evaluate(twoFramesPainted);
}

export async function signIn(page: Page, host: TestHost) {
  await page.goto(host.authUrl);
  await expect(page.getByText("No conversation selected").or(page.getByRole("heading", { name: "Set up a profile to start" }))).toBeVisible();
}

/** How Chromium fails a reload another one cut short: as an aborted load, or with the page it ran on already replaced. */
const RELOAD_CUT_SHORT = ["net::ERR_ABORTED", "Not attached to an active page"];

/**
 * Loads the page again from a host the spec just restarted. The page also loads again by itself once it reaches a
 * restarted host, which may serve newer code, and that cuts a reload in flight short, at times the next one too.
 */
export async function reloadFromRestartedHost(page: Page, triesLeft = 3) {
  try {
    await page.reload();
  } catch (error) {
    if (triesLeft === 1 || !RELOAD_CUT_SHORT.some((message) => String(error).includes(message))) throw error;
    test.info().annotations.push({ type: "reload cut short", description: "the page's own reload, on reaching the restarted host, cut the spec's short" });
    await reloadFromRestartedHost(page, triesLeft - 1);
  }
}

export async function addWorkspace(page: Page, directory: string, profile?: string) {
  await page.getByRole("button", { name: "+ Add a project directory" }).click();
  await enterWorkspaceDirectory(page, directory, profile);
}

async function enterWorkspaceDirectory(page: Page, directory: string, profile: string | undefined) {
  const input = page.getByLabel("Workspace directory");
  await input.fill(directory);
  await input.press("Enter");
  await pickProfileIfAsked(page, directory, profile);
  await expect(workspaceCard(page, directory)).toBeVisible();
}

/** With more than one profile, Enter on the folder asks which one its conversations start on: the one named, else the first. */
export async function pickProfileIfAsked(page: Page, directory: string, profile?: string) {
  const profiles = page.getByRole("listbox", { name: "Profile of the new workspace" });
  await expect(workspaceCard(page, directory).or(profiles).first()).toBeVisible();
  if (await profiles.isVisible()) {
    await (profile ? profiles.getByRole("option", { name: profile, exact: true }) : profiles.getByRole("option").first()).click();
  }
}

/** A Windows path's backslashes would start CSS escapes: in "C:\Users\…\AppData", \A is a line feed. */
const cssString = (text: string) => `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

export const workspaceCard = (scope: Page | FrameLocator, directory: string) =>
  scope.locator(".workspace", { has: scope.locator(`.workspace-heading[title=${cssString(directory)}]`) });

/** An entry of a workspace card's ⋯ menu: "Continue a session…", "Where conversations work…" or "Remove workspace…". */
export async function chooseInWorkspaceMenu(page: Page, entry: string, card: Locator = page.locator(".workspace")) {
  await card.getByRole("button", { name: "Workspace menu" }).click();
  await page.getByRole("menuitem", { name: entry, exact: true }).click();
}

/** Remove is asked twice: in the card's menu, and on the button that takes the menu's place in the heading. */
export async function removeWorkspace(page: Page, card: Locator) {
  await chooseInWorkspaceMenu(page, "Remove workspace…", card);
  await card.getByRole("button", { name: "Confirm: Remove workspace" }).click();
}

/** With the sidebar's button, which shows whether or not there are workspaces already. */
export async function addWorkspaceFromSidebar(page: Page, directory: string, profile?: string) {
  await page.getByRole("button", { name: "Add workspace" }).click();
  await enterWorkspaceDirectory(page, directory, profile);
}

/** Settings opens at Appearance; another page is chosen from its list on the left. */
export async function openSettings(page: Page, pageName = "Appearance") {
  await page.getByRole("button", { name: "Settings…" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("tab", { name: pageName }).click();
  return settings;
}

/** The Plugins dialog, from the sidebar's Plugins… */
export async function openPlugins(page: Page) {
  await page.getByRole("button", { name: "Plugins…" }).click();
  return page.getByRole("dialog", { name: "Plugins" });
}

/** A plugin's tile in the Plugins dialog's Installed or Discover list. */
export const pluginTile = (plugins: Locator, section: "Installed" | "Discover", title: string) =>
  plugins.getByRole("list", { name: section, exact: true }).getByRole("listitem", { name: title, exact: true });

/** Opens an installed plugin's own view by clicking its tile, which starts nothing. */
export async function openPluginDetail(plugins: Locator, title: string) {
  await pluginTile(plugins, "Installed", title).getByRole("button", { name: title, exact: true }).click();
  return plugins.getByRole("region", { name: title });
}

type VoiceSectionName = "Voice on this Mac" | "When you speak" | "Translating and summing up" | "When the agent replies" | "Models on this Mac";

/** One of the sections of Settings → Voice; a change there saves at once and says so in the section. */
export const voiceSection = (settings: Locator, name: VoiceSectionName) => settings.getByRole("group", { name, exact: true });

/** Points a voice service at an OpenAI-style server of the user's own, whose typed fields save together with the section's Save. */
export async function useOwnVoiceServer(
  section: Locator,
  choice: "Speech recognition" | "Voice model" | "Read aloud",
  { url, model, apiKey = "", voice = "" }: { url: string; model: string; apiKey?: string; voice?: string },
) {
  await section.getByLabel(choice).selectOption({ label: "With a server of your own" });
  await section.getByLabel("Address").fill(url);
  await section.getByLabel("API key").fill(apiKey);
  await section.getByLabel("Model", { exact: true }).fill(model);
  if (voice) await section.getByLabel("Voice", { exact: true }).fill(voice);
  await section.getByRole("button", { name: "Save" }).click();
  await expect(section.getByRole("status")).toHaveText("Saved.");
}

/**
 * Clicks Dictate and waits until the box holds what the voice server heard. When it doesn't, the error says where
 * dictation stopped, how many recordings reached the voice server and how busy the machine was: the release gate keeps
 * only the error's text in its bead, and this failure has come and gone with the machine rather than the code.
 */
export async function dictateInto(composer: Locator, expected: string, transcriptions: () => number) {
  const before = transcriptions();
  const dictate = composer.getByRole("button", { name: "Dictate" });
  await dictate.click();
  try {
    await expect(composer.locator("textarea")).toHaveValue(expected, { timeout: 30_000 });
  } catch (error) {
    throw new Error(`${await whyDictationStopped(composer.page(), dictate, transcriptions() - before)}\n${(error as Error).message}`);
  }
}

async function whyDictationStopped(page: Page, dictate: Locator, transcriptions: number) {
  const phase = (await dictate.getAttribute("class", { timeout: 1_000 }).catch(() => null))?.match(/\bdictate-(\w+)/)?.[1] ?? "unknown";
  const status = await page.locator(".dictation-status:visible").first().textContent({ timeout: 1_000 }).catch(() => null);
  const [lastMinute, lastFiveMinutes] = loadavg();
  return [
    `Dictation never filled in the box: it is ${phase}, its status ${status === null ? "shows nothing" : `says "${status}"`},`,
    `and the voice server got ${transcriptions} transcription request${transcriptions === 1 ? "" : "s"} since the click.`,
    `The machine's load: ${lastMinute!.toFixed(1)} over the last minute and ${lastFiveMinutes!.toFixed(1)} over five.`,
  ].join(" ");
}

/** One of the pictures in a choice of Settings, e.g. Light under Theme. */
export async function chooseInSettings(page: Page, label: string, option: string) {
  const settings = await openSettings(page);
  await settings.getByRole("radiogroup", { name: label }).getByRole("radio", { name: option }).click();
  await settings.getByRole("button", { name: "Close" }).click();
}

/** The open conversation's settings, opened from its bar unless they already are. */
export async function conversationSettings(page: Page) {
  const settings = page.getByRole("dialog", { name: "This conversation's settings" });
  if (!(await settings.isVisible())) await page.locator(".chat-header:visible .conversation-settings-toggle").click();
  await expect(settings).toBeVisible();
  return settings;
}

/** Turns YOLO on in the open conversation and closes its settings again, for the bar to show it. */
export async function turnOnYolo(page: Page) {
  const yolo = (await conversationSettings(page)).getByLabel("YOLO", { exact: true });
  await yolo.click();
  await expect(yolo).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.locator(".chat-header:visible .yolo-on")).toBeVisible();
}

/** `withModels` false for an agent that offers no model choice, such as Copilot on a bring-your-own-key provider. */
export async function startConversation(page: Page, { withModels = true } = {}) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await expect(page.locator(".chat-header:visible h2")).toHaveText("New conversation");
  if (withModels) await expect(page.locator(".chat-header:visible .settings-model")).toBeAttached({ timeout: 60_000 });
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

/** The view of the code review plugin's review or tour on the canvas, in its frame. */
export const walkthroughView = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-body > .canvas-frame.plugin iframe");

/** `text` to match as it is in a regular expression, as a Windows path with its backslashes: Playwright's Node has no RegExp.escape. */
export const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const primaryModifier = async (page: Page) => ((await page.evaluate(() => navigator.userAgent.includes("Mac"))) ? "Meta" : "Control");

/**
 * Sends a message and waits until the host has it, in the timeline or the queue, so a turn it starts already shows as
 * running. At least one more: what the message sets off may add one of its own first, as a script's mirador message does.
 */
export async function sendMessage(page: Page, text: string) {
  const composer = page.locator(".composer:visible textarea");
  await expect(composer).toBeEditable();
  await expect(page.locator(".composer:visible .send")).toBeVisible({ timeout: 120_000 });
  const taken = page.locator(".timeline:visible .message.user, .queue:visible .queued-text");
  const takenBefore = await taken.count();
  await composer.fill(text);
  await composer.press("Enter");
  await expect.poll(() => taken.count()).toBeGreaterThan(takenBefore);
}

/** The user messages and turn ends the page hears about, in the order they come. */
export function eventsInOrderOn(page: Page) {
  const events: string[] = [];
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      const event = JSON.parse(String(payload)).event?.event;
      if (event?.type === "turn-end") events.push("turn-end");
      if (event?.type === "user-message") events.push(event.text);
    }),
  );
  return events;
}

export async function waitForTurnToEnd(page: Page) {
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 180_000 });
}

export function lastAgentMessage(page: Page) {
  return page.locator(".timeline:visible .message.agent").last();
}

export async function openProfiles(page: Page) {
  await page.getByRole("button", { name: "Profiles…" }).click();
  return page.getByRole("dialog", { name: "Profiles" });
}

/** The profile editor's fields sit on tabs: Launch (name, colour, environment, pre-launch command), Defaults (model, mode, effort, questions, YOLO) and Plugins. */
export async function openProfileTab(profileEditor: Locator, tab: "Launch" | "Defaults" | "Plugins") {
  await profileEditor.getByRole("tab", { name: tab }).click();
}

/** A plugin's row on the profile editor's Plugins tab, opened to show its settings and tools. */
export async function openPluginRow(profileEditor: Locator, title: string) {
  const row = profileEditor.getByRole("group", { name: title, exact: true });
  const disclose = row.getByRole("button", { expanded: false });
  if (await disclose.isVisible()) await disclose.click();
  await expect(row.getByRole("button", { expanded: true })).toBeVisible();
  return row;
}

export async function createProfile(page: Page, name: string, environment: string, prelaunch = "", agent = "Claude Code") {
  const dialog = await openProfiles(page);
  await dialog.locator(".profile-list li", { hasText: "+ New profile" }).click();
  await openProfileTab(dialog, "Launch");
  await dialog.getByLabel("Profile name").fill(name);
  await dialog.getByLabel("Profile agent").selectOption({ label: agent });
  await dialog.getByLabel("Environment", { exact: true }).fill(environment);
  await dialog.getByLabel("Pre-launch command").fill(prelaunch);
  await dialog.getByRole("button", { name: "Create profile" }).click();
  await expect(dialog.locator(".profile-list li.selected")).toHaveText(`${name}${agent}`);
  return dialog;
}

/** Claude Code starts in Auto, which runs tools without asking, and refuses them where its safety check can't run. */
export async function startInManualMode(profileEditor: Locator) {
  await openProfileTab(profileEditor, "Defaults");
  await profileEditor.getByLabel("Profile mode", { exact: true }).selectOption("default", { timeout: 60_000 });
  await profileEditor.getByRole("button", { name: "Save" }).click();
  await expect(profileEditor.locator(".saved")).toHaveText("Saved");
}

export async function answerCanvasQuestion(page: Page, label: string) {
  const ask = page.locator(".ask");
  await ask.getByRole("radio", { name: label, exact: true }).check({ timeout: 240_000 });
  await ask.getByRole("button", { name: "Submit" }).click();
}

export async function openCanvasHistory(page: Page) {
  const toggle = page.locator(".history-toggle:visible");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return page.getByRole("list", { name: "Canvas history" });
}

export async function openFromCanvasHistory(page: Page, title: string) {
  const history = await openCanvasHistory(page);
  await history.locator(".history-entry", { hasText: title }).click();
}

/** What ⌘V does with a screenshot on the clipboard: a paste event that carries the image as a file. */
export async function pasteImage(target: Locator, { width, height, color = "#5b5bd6" }: { width: number; height: number; color?: string }) {
  await target.evaluate(
    async (element, image) => {
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext("2d")!;
      context.fillStyle = image.color;
      context.fillRect(0, 0, image.width, image.height);
      const transfer = new DataTransfer();
      transfer.items.add(new File([await canvas.convertToBlob({ type: "image/png" })], "screenshot.png", { type: "image/png" }));
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    },
    { width, height, color },
  );
}

/** Pastes HTML on the element as the browser does when copying from a web page or an editor, with `text` as the plain version, by default the HTML's text. */
export async function pasteHtml(target: Locator, html: string, text?: string) {
  await target.evaluate(
    (element, { html, text }) => {
      const transfer = new DataTransfer();
      transfer.setData("text/html", html);
      transfer.setData("text/plain", text ?? new DOMParser().parseFromString(html, "text/html").body.textContent ?? "");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    },
    { html, text },
  );
}

/** Pastes plain text on the element, as copying from a terminal does. */
export async function pasteText(target: Locator, text: string) {
  await target.evaluate((element, pasted) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", pasted);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, text);
}

/** Drops files on the element as the browser does from the Finder: an image for each name without text, else a text file. */
export async function dropFiles(target: Locator, files: { name: string; text?: string }[]) {
  await target.evaluate(async (element, dropped) => {
    const transfer = new DataTransfer();
    for (const { name, text } of dropped) {
      if (text === undefined) {
        const canvas = new OffscreenCanvas(40, 30);
        canvas.getContext("2d")!.fillRect(0, 0, 40, 30);
        transfer.items.add(new File([await canvas.convertToBlob({ type: "image/png" })], name, { type: "image/png" }));
      } else {
        transfer.items.add(new File([text], name, { type: "text/plain" }));
      }
    }
    element.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, files);
}

/** The match the find bar is on: its text, the entry it is in, and whether it shows in its conversation's view. */
export const currentMatch = (page: Page) =>
  page.evaluate(() => {
    const [range] = [...(CSS.highlights.get("find-current") ?? [])] as Range[];
    if (!range) return null;
    const entry = range.startContainer.parentElement!.closest(".timeline-entry")!;
    const view = entry.closest(".timeline")!.getBoundingClientRect();
    const match = range.getBoundingClientRect();
    return { text: range.toString(), entry: entry.textContent, inView: match.height > 0 && match.top >= view.top && match.bottom <= view.bottom };
  });

interface RecordedNotification {
  title: string;
  body?: string;
  tag?: string;
  closed: boolean;
  onclick: (() => void) | null;
}

type WithRecordedNotifications = { recordedNotifications: RecordedNotification[] };

/** Stands in for the browser's notifications, already allowed, keeping each one shown. */
export async function allowNotifications(page: Page) {
  await page.addInitScript(() => {
    const recorded: unknown[] = [];
    class RecordingNotification {
      static permission = "granted";
      static requestPermission = async () => "granted";
      onclick = null;
      closed = false;
      body?: string;
      tag?: string;

      constructor(
        readonly title: string,
        options: NotificationOptions = {},
      ) {
        this.body = options.body;
        this.tag = options.tag;
        recorded.push(this);
      }

      close() {
        this.closed = true;
      }
    }
    Object.assign(window, { Notification: RecordingNotification, recordedNotifications: recorded });
  });
}

export const notificationsShown = (scope: Page | Frame) =>
  scope.evaluate(() => (window as unknown as WithRecordedNotifications).recordedNotifications.map(({ title, body, tag, closed }) => ({ title, body, tag, closed })));

/** Clicks the latest notification with this body, where other notifications may come after it. */
export const clickNotification = (page: Page, body: string) =>
  page.evaluate((body) => (window as unknown as WithRecordedNotifications).recordedNotifications.findLast((notification) => notification.body === body)!.onclick!(), body);

/** A file git checked out, as written: Git for Windows checks text files out with CRLF line ends. */
export const checkedOutText = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");
