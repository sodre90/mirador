import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page, type WebSocket } from "@playwright/test";
import { addWorkspace, reloadFromRestartedHost, signIn, startConversation, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(async () => {
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const timeline = (page: Page) => page.locator(".timeline:visible");
const selectInSidebar = (page: Page, conversationId: string) => page.locator(`[data-reorder-id="${conversationId}"]`).click();

/** What the host sent this page over its socket, as text. */
function framesReceived(page: Page) {
  const frames: string[] = [];
  page.on("websocket", (socket: WebSocket) => socket.on("framereceived", ({ payload }) => frames.push(String(payload))));
  return {
    historiesOf: (conversationId: string) => frames.filter((frame) => frame.startsWith(`{"type":"conversation.history","conversationId":"${conversationId}"`)).length,
    anyContaining: (text: string) => frames.some((frame) => frame.includes(text)),
  };
}

const entryAtTopOf = (page: Page) =>
  timeline(page).evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const entry = [...element.querySelectorAll(":scope > .timeline-entry")].find((entry) => entry.getBoundingClientRect().bottom > top)!;
    return { text: entry.textContent!, offset: Math.round(entry.getBoundingClientRect().top - top) };
  });

test("a recently opened conversation shows again at once, where it was left, with what arrived meanwhile", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const other = await startConversation(page);
  const long = await startConversation(page);
  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "seed-long-conversation.ts"), join(host.dataDir, "state.sqlite"), long, "225"]);
  await host.start();
  const received = framesReceived(page);
  await reloadFromRestartedHost(page);
  await expect(timeline(page).locator(".timeline-entry").last()).toContainText("answer 224");

  await test.step("output of a command that finishes while another conversation is shown is there on return, at the bottom where the reader was", async () => {
    const composer = page.locator(".composer textarea:visible");
    await composer.fill("!sleep 2 && echo printed while away");
    await composer.press("Enter");
    await selectInSidebar(page, other);
    await expect(page.locator(".chat-header h2:visible")).toHaveText("New conversation");
    await expect.poll(() => received.anyContaining("printed while away"), { timeout: 20_000 }).toBe(true);
    await selectInSidebar(page, long);
    await expect(timeline(page).getByText("printed while away")).toBeInViewport();
    expect(received.historiesOf(long)).toBe(1);
  });

  await test.step("a reader halfway up the conversation comes back to the same entry", async () => {
    await timeline(page).evaluate((element) => (element.scrollTop = element.scrollHeight / 2));
    await expect.poll(() => timeline(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const before = await entryAtTopOf(page);
    await selectInSidebar(page, other);
    await expect(page.locator(".chat-header h2:visible")).toHaveText("New conversation");
    await selectInSidebar(page, long);
    await expect(timeline(page)).toBeVisible();
    expect(await entryAtTopOf(page)).toEqual(before);
    expect(received.historiesOf(long)).toBe(1);
    expect(received.historiesOf(other)).toBe(1);
  });
});

test("a scroll that reaches a conversation's timeline after another conversation is shown throws nothing", async ({ page }) => {
  await signIn(page, host);
  const addProject = page.getByRole("button", { name: "+ Add a project directory" });
  await expect(addProject.or(workspaceCard(page, host.projectDir))).toBeVisible();
  if (await addProject.isVisible()) await addWorkspace(page, host.projectDir);
  await startConversation(page);
  const leftTimeline = await timeline(page).elementHandle();
  await startConversation(page);
  await expect.poll(() => leftTimeline!.evaluate((element) => element.isConnected && !element.checkVisibility())).toBe(true);

  const thrown = await leftTimeline!.evaluate((element) => {
    const errors: string[] = [];
    const note = (event: ErrorEvent) => errors.push(event.message);
    window.addEventListener("error", note);
    element.dispatchEvent(new Event("scroll"));
    window.removeEventListener("error", note);
    return errors;
  });
  expect(thrown).toEqual([]);
});
