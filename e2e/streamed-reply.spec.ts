import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });

/** An opencode that is the scripted agent, streaming the words a prompt asks for. */
const fakeOpencode = () =>
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });

test.beforeAll(async () => {
  fakeOpencode();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const WORD_COUNT = 300;
const words = Array.from({ length: WORD_COUNT }, (_, index) => `word${index + 1}`);

/** Counts the batches of DOM changes that touch an agent message: one for each time its text is re-rendered. */
async function countAgentMessageUpdates(page: Page) {
  await page.evaluate(() => {
    const counter = window as unknown as { agentMessageUpdates: number };
    const agentMessageOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest(".message.agent");
    const touchesAgentMessage = (node: Node) => agentMessageOf(node) != null || (node instanceof Element && node.querySelector(".message.agent") != null);
    counter.agentMessageUpdates = 0;
    new MutationObserver((records) => {
      if (records.some(({ target, addedNodes }) => [target, ...addedNodes].some(touchesAgentMessage))) counter.agentMessageUpdates++;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { agentMessageUpdates: number }).agentMessageUpdates);
}

test("a reply that streams in word by word shows all of its text once the turn ends, re-rendered a few times a second rather than per word", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "stream", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "stream · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page.locator(".chat-header:visible h2")).toHaveText("New conversation");
  const agentMessageUpdates = await countAgentMessageUpdates(page);
  const countedFrom = Date.now();
  await sendMessage(page, `STREAM ${WORD_COUNT}`);
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText(words.join(" "));
  // The text re-renders at most once per 150 ms, so the seconds the reply took bound the updates however fast or slow the machine delivers the words. Without the throttling the page re-renders every word, which on a loaded machine stretches past the bound.
  const updates = await agentMessageUpdates();
  const secondsCounted = (Date.now() - countedFrom) / 1000;
  expect(updates).toBeGreaterThan(5);
  expect(updates).toBeLessThan(secondsCounted * 8 + 10);
});

test("a long reply keeps the reader at its newest line while it streams in", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 560 });
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "stream · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page.locator(".chat-header:visible h2")).toHaveText("New conversation");
  await sendMessage(page, "STREAM 600");
  await expect(lastAgentMessage(page)).toContainText("word450");
  const below = await page.locator(".timeline:visible").evaluate((timeline) => ({
    hidden: timeline.scrollHeight - timeline.clientHeight,
    unread: timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop,
  }));
  expect(below.hidden).toBeGreaterThan(400);
  expect(below.unread).toBeLessThan(150);
  await waitForTurnToEnd(page);
});

test("a reply of many paragraphs ends with the reader at its last line, though its text shows a moment after the last chunk", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 560 });
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "stream · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page.locator(".chat-header:visible h2")).toHaveText("New conversation");
  await sendMessage(page, "STREAM PARAGRAPHS 80");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Paragraph 80 ");
  const timeline = page.locator(".timeline:visible");
  expect(await timeline.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(1000);
  await expect.poll(() => timeline.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);
});

test("a reader who scrolled up while a reply streams in stays on the line they were reading", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 560 });
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "stream · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page.locator(".chat-header:visible h2")).toHaveText("New conversation");
  await sendMessage(page, "STREAM PARAGRAPHS 300");
  await expect(lastAgentMessage(page)).toContainText("Paragraph 30 ");
  const timeline = page.locator(".timeline:visible");
  const heightWhenScrolled = await timeline.evaluate((element) => {
    element.scrollTop = 100;
    element.dispatchEvent(new Event("scroll"));
    return element.scrollHeight;
  });
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Paragraph 300 ");
  const place = await timeline.evaluate((element) => ({ top: element.scrollTop, height: element.scrollHeight, unread: element.scrollHeight - element.clientHeight - element.scrollTop }));
  // What follows only says something about a reader who scrolled up mid-reply: the reply has to keep growing under them.
  expect(place.height - heightWhenScrolled).toBeGreaterThan(500);
  expect(Math.abs(place.top - 100)).toBeLessThanOrEqual(2);
  expect(place.unread).toBeGreaterThan(1000);
});

test("a reader at the bottom who opens a tool call stays where they are", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 560 });
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "stream · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page.locator(".chat-header:visible h2")).toHaveText("New conversation");
  await sendMessage(page, "STREAM PARAGRAPHS 60");
  await waitForTurnToEnd(page);
  await sendMessage(page, 'RUN TOOLS [{"title":"Read a.ts","kind":"read","rawInput":{"path":"a.ts"}}]');
  await waitForTurnToEnd(page);
  const timeline = page.locator(".timeline:visible");
  const toolCall = timeline.locator("details.tool").last();
  await expect(toolCall).toHaveJSProperty("open", false);
  const atTheBottom = await timeline.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
    return element.scrollTop;
  });
  await toolCall.locator(":scope > summary").click();
  await expect(toolCall).toHaveJSProperty("open", true);
  expect(Math.abs((await timeline.evaluate((element) => element.scrollTop)) - atTheBottom)).toBeLessThanOrEqual(2);
});
