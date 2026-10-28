import { spawn } from "node:child_process";
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

export async function callCanvasTool(host: TestHost, conversationId: string, name: string, args: Record<string, unknown>) {
  const response = await fetch(`${host.origin}/mcp/${conversationId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${host.mcpToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await response.text();
  const payload = body
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  const message = JSON.parse(payload ?? body);
  return message.result.content[0].text as string;
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

/** One of the pictures in a choice of Settings, e.g. Light under Theme. */
export async function chooseInSettings(page: Page, label: string, option: string) {
  const settings = await openSettings(page);
  await settings.getByRole("radiogroup", { name: label }).getByRole("radio", { name: option }).click();
  await settings.getByRole("button", { name: "Close" }).click();
}

export async function startConversation(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await expect(page.locator(".chat-header:visible h2")).toHaveText("New conversation");
  await expect(page.locator(".chat-header:visible").getByLabel("Model", { exact: true })).toBeVisible({ timeout: 60_000 });
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

/** `text` to match as it is in a regular expression, as a Windows path with its backslashes: Playwright's Node has no RegExp.escape. */
/** The view of the code review plugin's review or tour on the canvas, in its frame. */
export const walkthroughView = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-body > .canvas-frame.plugin iframe");

export const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const primaryModifier = async (page: Page) => ((await page.evaluate(() => navigator.userAgent.includes("Mac"))) ? "Meta" : "Control");

/** Sends a message and waits until the host has it, in the timeline or the queue, so a turn it starts already shows as running. */
export async function sendMessage(page: Page, text: string) {
  const composer = page.locator(".composer:visible textarea");
  await expect(composer).toBeEditable();
  await expect(page.locator(".composer:visible .send")).toBeVisible({ timeout: 120_000 });
  const taken = page.locator(".timeline:visible .message.user, .queue:visible .queued-text");
  const takenBefore = await taken.count();
  await composer.fill(text);
  await composer.press("Enter");
  await expect(taken).toHaveCount(takenBefore + 1);
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

export async function createProfile(page: Page, name: string, environment: string, prelaunch = "", agent = "Claude Code") {
  const dialog = await openProfiles(page);
  await dialog.locator(".profile-list li", { hasText: "+ New profile" }).click();
  await dialog.getByLabel("Profile name").fill(name);
  await dialog.getByLabel("Profile agent").selectOption({ label: agent });
  await dialog.getByLabel("Environment", { exact: true }).fill(environment);
  await dialog.getByLabel("Pre-launch command").fill(prelaunch);
  await dialog.getByRole("button", { name: "Create profile" }).click();
  await expect(dialog.locator(".profile-list li.selected")).toHaveText(`${name}${agent}`);
  return dialog;
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

export const clickLatestNotification = (page: Page) => page.evaluate(() => (window as unknown as WithRecordedNotifications).recordedNotifications.at(-1)!.onclick!());

/** Clicks the latest notification with this body, where other notifications may come after it. */
export const clickNotification = (page: Page, body: string) =>
  page.evaluate((body) => (window as unknown as WithRecordedNotifications).recordedNotifications.findLast((notification) => notification.body === body)!.onclick!(), body);
