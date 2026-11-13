import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const logFile = join(host.root, "agent-log");
const agentSaw = () => readFileSync(promptsFile, "utf8");
const agentLog = () => readFileSync(logFile, "utf8");
let page: Page;

test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), {
    FAKE_ACP_PROMPTS: promptsFile,
    FAKE_ACP_MODES: "1",
    FAKE_ACP_LOG: logFile,
  });
  writeFileSync(promptsFile, "");
  writeFileSync(logFile, "");
  await host.start();
  page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  for (const [name, environment] of [
    ["Forks", "FAKE_ACP_FORKS=1"],
    ["Fresh", ""],
  ]) {
    const profiles = await createProfile(page, name!, environment!, "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
  }
});
test.afterAll(async () => {
  await page.close();
  await host.stop();
  await host.cleanUp();
});

const mainChat = () => page.locator(".main-chat:visible");
const mainComposer = () => mainChat().locator(".composer textarea");
const sideChat = () => page.locator(".side-chat:visible");
const sideAnswers = () => sideChat().locator(".timeline .message.agent");
const sidebarRow = (conversationId: string) => page.locator(`.workspace li[data-reorder-id="${conversationId}"]`);
const shownConversationId = () => page.url().match(/#\/c\/(.+)$/)![1]!;

async function startOn(profile: string) {
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profile} · opencode` });
  return startConversation(page, { withModels: false });
}

async function askWithBtw(question: string) {
  await mainComposer().fill(`/btw ${question}`);
  await mainComposer().press("Enter");
  await expect(sideChat().locator(".side-chat-heading h2")).toHaveText(question);
  await expect(mainComposer()).toHaveValue("");
}

/** Selects the words in the shown conversation's timeline, as dragging over them would, which takes focus from the message box. */
async function selectInConversation(words: string) {
  await page.evaluate((wanted) => {
    (document.activeElement as HTMLElement | null)?.blur();
    const timeline = [...document.querySelectorAll(".main-chat .timeline")].find((element) => element.checkVisibility())!;
    const walker = document.createTreeWalker(timeline, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent!.indexOf(wanted);
      if (at === -1) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      return;
    }
    throw new Error(`"${wanted}" is not in the conversation`);
  }, words);
}

test("/btw asks beside the conversation in a copy of its session, in plan mode, with what it asks to do turned down", async () => {
  const mainId = await startOn("Forks");
  await sendMessage(page, "SAY the build retries twice");
  await waitForTurnToEnd(page);

  await askWithBtw("SAY it retries on timeouts");
  await expect(sideAnswers().last()).toHaveText("it retries on timeouts");
  await expect(sideChat().locator(".side-chat-access")).toHaveText("Can change files");
  await expect(mainChat().locator(".timeline .message.agent")).toHaveText(["the build retries twice"]);
  expect(agentSaw()).toContain("<mirador-side-chat>");
  expect(agentSaw()).toContain("This session is a copy of the main conversation.");
  await expect.poll(agentLog).toContain("set mode to plan");

  await test.step("what its agent asks permission for is turned down without asking the user", async () => {
    const composer = sideChat().locator(".composer textarea");
    await composer.fill('TOOLS [{"kind":"execute","title":"Run rm -rf build"}]');
    await composer.press("Enter");
    await expect(sideAnswers().last()).toHaveText("Run rm -rf build: reject");
    await expect(page.locator(".permission:visible")).toHaveCount(0);
  });

  await test.step("its answer goes to the main conversation's message box as a quote, for the user to send", async () => {
    await sideChat().getByRole("button", { name: "Send to main chat" }).click();
    await expect(mainComposer()).toHaveValue(/^From a side chat:\n\n> Run rm -rf build: reject/);
    await mainComposer().fill("");
  });

  await test.step("the sidebar keeps it folded under its conversation, and picking it there shows it beside the conversation again", async () => {
    const toggle = sidebarRow(mainId).locator(".delegated-toggle");
    await expect(toggle).toHaveAccessibleName("1 side chat");
    await sideChat().getByRole("button", { name: "Close side chat" }).click();
    await expect(sideChat()).toHaveCount(0);
    const row = page.locator(".workspace li.side-chat-row");
    if (!(await row.isVisible())) await toggle.click();
    await row.click();
    expect(shownConversationId()).toBe(mainId);
    await expect(sideChat().locator(".side-chat-heading h2")).toHaveText("SAY it retries on timeouts");
  });

  await test.step("Esc puts it away and goes back to the conversation's message box", async () => {
    await sideChat().locator(".composer textarea").focus();
    await page.keyboard.press("Escape");
    await expect(sideChat()).toHaveCount(0);
    await expect(mainComposer()).toBeFocused();
  });

  await test.step("opened as a conversation, it leaves the column for the main pane, in the mode the conversation is in", async () => {
    const sideChatId = (await page.locator(".workspace li.side-chat-row").getAttribute("data-reorder-id"))!;
    await page.evaluate((id) => (location.hash = `#/c/${id}`), sideChatId);
    await expect(page).toHaveURL(new RegExp(`#/c/${mainId}$`));
    await sideChat().getByRole("button", { name: "Open as conversation" }).click();
    await expect(page).toHaveURL(new RegExp(`#/c/${sideChatId}$`));
    await expect(page.locator(".chat-header:visible h2")).toHaveText("SAY it retries on timeouts");
    await expect(sideChat()).toHaveCount(0);
    await expect(sidebarRow(sideChatId)).not.toHaveClass(/under-caller/);
    await expect.poll(agentLog).toContain("set mode to default");
  });
});

test("text selected in the conversation is quoted into a new side chat, or into the reply", async () => {
  const mainId = await startOn("Forks");
  await sendMessage(page, "SAY the cache key includes the lockfile hash");
  await waitForTurnToEnd(page);

  await selectInConversation("lockfile hash");
  await page.locator(".selection-actions").getByRole("button", { name: "Quote in reply" }).click();
  await expect(mainComposer()).toHaveValue("> lockfile hash\n\n");
  await expect(mainComposer()).toBeFocused();
  await mainComposer().fill("");

  await selectInConversation("cache key");
  await page.locator(".selection-actions").getByRole("button", { name: "Ask in side chat" }).click();
  await expect(sideChat().locator(".side-chat-quote span")).toHaveText(["cache key"]);
  await selectInConversation("lockfile hash");
  await page.keyboard.press("Alt+KeyB");
  await expect(sideChat().locator(".side-chat-quote span")).toHaveText(["cache key", "lockfile hash"]);

  const question = sideChat().getByLabel("Ask about this conversation…");
  await question.fill("why both?");
  await question.press("Enter");
  await expect(sideChat().locator(".side-chat-heading h2")).toHaveText("why both?");
  await expect.poll(agentSaw).toContain("> cache key\n\n> lockfile hash\n\nwhy both?");
  await expect(sidebarRow(mainId).locator(".delegated-toggle")).toHaveAccessibleName("1 side chat");

  await expect(sideChat().locator(".composer .stop")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sideChat()).toHaveCount(0);
  await mainChat().getByRole("button", { name: "Side chat", exact: true }).click();
  await expect(sideChat().locator(".side-chat-heading h2")).toHaveText("New question");
  await page.keyboard.press("Alt+KeyB");
  await expect(sideChat()).toHaveCount(0);
});

test("an agent that can't copy its session hears the conversation as text with the first question", async () => {
  await startOn("Fresh");
  await sendMessage(page, "SAY deploys go out on Tuesdays");
  await waitForTurnToEnd(page);

  await askWithBtw("SAY noted");
  await expect(sideAnswers().last()).toHaveText("noted");
  const brief = agentSaw().slice(agentSaw().lastIndexOf("<mirador-side-chat>"));
  expect(brief).toContain("<conversation>\nUser: SAY deploys go out on Tuesdays\n\nAssistant: deploys go out on Tuesdays\n</conversation>");
});
