import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, sendMessage, signIn, startDesktopNotifier } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");

/** An opencode that is an agent of its own, holding a WRITE turn until the file it waits for exists. */
function fakeOpencode() {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
}

const prompts = () => readFileSync(promptsFile, "utf8").split("\n");
const status = (page: Page) => page.locator(".chat-header:visible .badge");
const heldTurn = (release: string, ended?: string) =>
  `WRITE ${JSON.stringify([{ waitFor: release }, ...(ended ? [{ shell: ended, content: "" }] : [])])}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fakeOpencode();
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

async function useProfile(page: Page, name: string, environment: string) {
  const profiles = await createProfile(page, name, environment, "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${name} · opencode` });
}

/** The stub agent offers no model to pick, so this is `startConversation` without that wait. */
async function startConversationWithoutModel(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await expect(status(page)).toHaveText("idle", { timeout: 30_000 });
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

/** Listens the way the desktop app does and returns the counts of waiting conversations and running turns the host has announced so far. */
async function listenLikeTheDesktopApp() {
  const signedIn = await fetch(host.authUrl, { redirect: "manual" });
  const token = signedIn.headers.get("set-cookie")!.split(";")[0]!.split("=")[1]!;
  const desktopApp = startDesktopNotifier(host.origin, token);
  const waiting: number[] = [];
  const runningTurns: number[] = [];
  createInterface({ input: desktopApp.stdout! }).on("line", (line) => {
    const [, kind, count] = line.match(/^(waiting|running-turns) (\d+)\b/) ?? [];
    if (kind === "waiting") waiting.push(Number(count));
    if (kind === "running-turns") runningTurns.push(Number(count));
  });
  // The host reports the running turns as the notifier's socket opens, so this first count is the host before the test's own turn.
  // Waiting for it keeps a slow-to-start notifier from first reporting the turn the test has already begun.
  await expect.poll(() => runningTurns[0], { timeout: 30_000 }).toBe(0);
  return { waiting, runningTurns, stop: () => desktopApp.kill() };
}

test("a conversation deleted while its turn runs stops counting as a running turn at once, and leaves nothing waiting for you once the turn ends", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await useProfile(page, "fake", "");
  const desktopApp = await listenLikeTheDesktopApp();
  try {
    await startConversationWithoutModel(page);
    const release = join(host.root, "release-deleted-turn");
    const ended = join(host.root, "deleted-turn-ended");
    await sendMessage(page, heldTurn(release, ended));
    await expect(status(page)).toHaveText("running", { timeout: 30_000 });
    await expect.poll(() => desktopApp.runningTurns.at(-1)).toBe(1);
    const deleteButton = page.locator(".workspace li.selected").getByRole("button", { name: "Delete conversation" });
    await deleteButton.click();
    await deleteButton.click();
    await expect.poll(() => desktopApp.runningTurns.at(-1)).toBe(0);

    const other = await startConversationWithoutModel(page);
    writeFileSync(release, "");
    await expect.poll(() => existsSync(ended)).toBe(true);
    await page.waitForTimeout(500);
    void callCanvasTool(host, other, "ask", { question: "Still one?", options: [{ label: "Yes" }, { label: "No" }] }).catch(() => {});
    await expect(page.getByRole("heading", { name: "Still one?" })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => desktopApp.waiting.at(-1)).toBe(1);
    await page.waitForTimeout(500);
    expect(Math.max(...desktopApp.waiting)).toBe(1);
    expect(desktopApp.runningTurns).toEqual([0, 1, 0]);
  } finally {
    desktopApp.stop();
  }
});

test("a message queued behind a turn sent while /clear opens the fresh session goes out once that turn ends", async ({ page }) => {
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
  await useProfile(page, "slow close", "FAKE_ACP_MODES=1\nFAKE_ACP_ANSWERS_AFTER_MS=4000");
  await startConversationWithoutModel(page);
  const composer = page.locator(".composer:visible textarea");

  await composer.fill("/clear");
  await composer.press("Enter");
  await expect(page.locator(".notice-line", { hasText: "Context cleared" })).toHaveCount(1);
  const release = join(host.root, "release-turn-after-clear");
  await composer.fill(heldTurn(release));
  await composer.press("Enter");
  await expect(page.locator(".timeline:visible .message.user")).toHaveCount(1);
  await composer.fill("queued behind the turn");
  await composer.press("Enter");
  await expect(page.locator(".queue:visible .queued-text")).toHaveText(["queued behind the turn"]);
  await expect(status(page)).toHaveText("starting");
  await expect(status(page)).toHaveText("running", { timeout: 30_000 });

  await expect.poll(prompts, { timeout: 30_000 }).toContain(heldTurn(release));
  writeFileSync(release, "");
  await expect.poll(prompts, { timeout: 30_000 }).toContain("queued behind the turn");
});

test("a message sent while a queued /clear opens the fresh session goes out after the messages queued behind the /clear", async ({ page }) => {
  await signIn(page, host);
  await page.locator(".workspace li").first().click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "slow close · opencode" });
  await startConversationWithoutModel(page);
  const composer = page.locator(".composer:visible textarea");
  const send = async (text: string) => {
    await composer.fill(text);
    await composer.press("Enter");
  };

  const release = join(host.root, "release-turn-before-clear");
  await send(heldTurn(release));
  await expect(status(page)).toHaveText("running", { timeout: 30_000 });
  for (const text of ["/clear", "first behind the clear", "second behind the clear"]) await send(text);
  await expect(page.locator(".queue:visible .queued-text")).toHaveText(["/clear", "first behind the clear", "second behind the clear"]);

  writeFileSync(release, "");
  await expect(page.locator(".notice-line", { hasText: "Context cleared" })).toHaveCount(1);
  await send("sent while the context clears");

  const inOrderSent = ["first behind the clear", "second behind the clear", "sent while the context clears"];
  await expect.poll(() => prompts().filter((prompt) => inOrderSent.includes(prompt)), { timeout: 30_000 }).toEqual(inOrderSent);
});
