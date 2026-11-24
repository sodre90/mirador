import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { addWorkspace, clickWorkspaceButton, createProfile, openSettings, sendMessage, signIn, startConversation, waitForTurnToEnd, workspaceCard } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";
import type { ClientMessage } from "../shared/protocol.ts";

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
  writeBunProgram(host.fakeProgramsDir, "agy", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile, FAKE_ACP_MODES: "1" });
  writeFileSync(promptsFile, "");
  writeFileSync(logFile, "");
  await host.start();
  page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  for (const [name, environment, agent] of [
    ["Forks", "FAKE_ACP_FORKS=1", "opencode"],
    ["Fresh", "", "opencode"],
    ["Agy", "", "Antigravity"],
  ]) {
    const profiles = await createProfile(page, name!, environment!, "", agent);
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

async function startOn(profile: string, agent = "opencode") {
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profile} · ${agent}` });
  return startConversation(page, { withModels: false });
}

/** What the host answers a person's own socket that sends the message. */
async function personSends(personPage: Page, message: ClientMessage) {
  return personPage.evaluate(
    (sent) =>
      new Promise<string>((answered) => {
        const socket = new WebSocket(new URL("ws", location.href.replace(/^http/, "ws")));
        socket.onmessage = ({ data }) => {
          const message = JSON.parse(String(data));
          if (message.type === "snapshot") socket.send(JSON.stringify(sent));
          if (message.type === "error" || message.type === "conversation.side-chat.started") answered(message.problem?.code ?? message.type);
        };
      }),
    message,
  );
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

/** How many times the page reads the text of a selection while `act` runs, two frames after it included. */
async function selectionTextReadsDuring(act: () => Promise<void>) {
  await page.evaluate(() => {
    const counted = window as typeof window & { selectionTextReads?: number };
    if (counted.selectionTextReads === undefined) {
      const { toString } = Selection.prototype;
      Selection.prototype.toString = function () {
        counted.selectionTextReads!++;
        return toString.call(this);
      };
    }
    counted.selectionTextReads = 0;
  });
  await act();
  return page.evaluate(async () => {
    const nextFrame = () => new Promise((painted) => requestAnimationFrame(painted));
    await nextFrame();
    await nextFrame();
    return (window as typeof window & { selectionTextReads?: number }).selectionTextReads!;
  });
}

const scrollConversation = () =>
  mainChat()
    .locator(".timeline")
    .evaluate((timeline) => {
      timeline.dispatchEvent(new Event("scroll"));
    });

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

  await test.step("scrolling reads a selection's text only while there is one: reading it lays the whole page out", async () => {
    await page.evaluate(() => getSelection()!.removeAllRanges());
    expect(await selectionTextReadsDuring(scrollConversation)).toBe(0);
    await mainChat().locator(".chat-header h2").click();
    expect(await selectionTextReadsDuring(scrollConversation), "a click leaves an empty selection").toBe(0);
    await selectInConversation("lockfile hash");
    expect(await selectionTextReadsDuring(scrollConversation)).toBeGreaterThan(0);
  });

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

test("the divider beside a side chat drags it wider, keeps that width after a reload and gives way to the conversation in a smaller window, the arrow keys step it, and a double-click puts it back", async () => {
  await startOn("Fresh");
  await page.locator(".layout-toggles:visible").getByRole("button", { name: "Hide canvas" }).click();
  await mainChat().getByRole("button", { name: "Side chat", exact: true }).click();
  const divider = page.getByRole("separator", { name: "Resize the side panel" });
  await expect(divider).toHaveAttribute("aria-orientation", "vertical");
  const sideWidth = async () => (await sideChat().boundingBox())!.width;
  const before = await sideWidth();
  const box = (await divider.boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 120, y, { steps: 10 });
  await page.mouse.up();
  const dragged = await sideWidth();
  expect(Math.abs(dragged - (before + 120))).toBeLessThan(6);

  await page.reload();
  await expect(sideChat().locator(".side-chat-heading h2")).toHaveText("New question");
  expect(Math.abs((await sideWidth()) - dragged)).toBeLessThan(1);

  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 1100, height: viewport.height });
  await expect.poll(sideWidth).toBeLessThan(dragged);
  expect((await mainChat().boundingBox())!.width).toBeGreaterThanOrEqual(310);
  await page.setViewportSize(viewport);
  await expect.poll(sideWidth).toBe(dragged);

  await divider.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(sideWidth).toBeLessThan(dragged - 10);
  await divider.dblclick();
  await expect.poll(async () => Math.abs((await sideWidth()) - before)).toBeLessThan(1);
});

test("Antigravity's side chats only read, unless Settings or their workspace let them change files, and only the owner opens one", async ({ browser }) => {
  const mainId = await startOn("Agy", "Antigravity");
  await sendMessage(page, "SAY the build retries twice");
  await waitForTurnToEnd(page);

  await test.step("by default a side chat is held to reading, in the agent's plan mode", async () => {
    await askWithBtw("CHOICES by default");
    await expect(sideAnswers().last()).toContainText("mode plan");
    await expect(sideChat().locator(".side-chat-access")).toHaveText("Read-only");
  });

  await test.step("once Settings let side chats change files, a new one works in the conversation's mode and asks the user what its agent asks to do", async () => {
    const settings = await openSettings(page, "Conversations");
    await settings.getByLabel("New side chats").selectOption({ label: "Can change files" });
    await settings.getByRole("button", { name: "Close" }).click();
    await askWithBtw("CHOICES once Settings let it");
    await expect(sideAnswers().last()).toContainText("mode default");
    await expect(sideChat().locator(".side-chat-access")).toHaveText("Can change files");
    const composer = sideChat().locator(".composer textarea");
    await composer.fill('TOOLS [{"kind":"edit","title":"Fix the typo"}]');
    await composer.press("Enter");
    const permission = page.locator(".permission.pending:visible");
    await expect(permission).toHaveCount(1);
    await permission.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(sideAnswers().last()).toHaveText("Fix the typo: reject");
  });

  await test.step("a workspace that holds its side chats to reading wins over Settings", async () => {
    await clickWorkspaceButton(workspaceCard(page, host.projectDir), "Where conversations work…");
    const dialog = page.getByRole("dialog", { name: /^Where conversations work in / });
    await expect(dialog.getByRole("radio", { name: /^As in Settings/ })).toBeChecked();
    await dialog.getByRole("radio", { name: /^Read-only/ }).check();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await sideChat().locator(".composer textarea").focus();
    await page.keyboard.press("Escape");
    await mainChat().getByRole("button", { name: "Side chat", exact: true }).click();
    await expect(sideChat().locator(".side-chat-heading h2")).toHaveText("New question");
    await expect(sideChat().locator(".side-chat-access")).toHaveText("Read-only");
    await page.keyboard.press("Alt+KeyB");
    await askWithBtw("CHOICES once the workspace holds it");
    await expect(sideAnswers().last()).toContainText("mode plan");
    await expect(sideChat().locator(".side-chat-access")).toHaveText("Read-only");
  });

  await test.step("a person signed in on their own browser is refused a side chat beside the owner's conversation, and what its side chats may do", async () => {
    const mia = host.admitPerson("Mia");
    const miaContext = await browser.newContext();
    await miaContext.addCookies([mia.cookie]);
    const miaPage = await miaContext.newPage();
    await miaPage.goto(host.origin);
    expect(await personSends(miaPage, { type: "conversation.side-chat.start", requestId: "asked", conversationId: mainId, text: "CHOICES" })).toBe("only-the-owner");
    expect(await personSends(miaPage, { type: "conversation.set-side-chat-access", conversationId: mainId, sideChatAccess: "can-change-files" })).toBe("only-the-owner");
    await miaContext.close();
    await expect(sidebarRow(mainId).locator(".delegated-toggle")).toHaveAccessibleName("3 side chats");
  });
});

test("a side chat is switched to change files and back while it is open, and its conversation's next side chats start as it was left", async () => {
  const switched = () => sideChat().getByLabel("What this side chat may do");
  const label = () => sideChat().locator(".side-chat-access");
  const askInSideChat = async (text: string) => {
    const composer = sideChat().locator(".composer textarea");
    await composer.fill(text);
    await composer.press("Enter");
  };
  const mainId = await startOn("Agy", "Antigravity");
  await sendMessage(page, "SAY the build retries twice");
  await waitForTurnToEnd(page);

  await test.step("switched to change files, though its workspace holds side chats to reading, it works in the conversation's mode and asks the user", async () => {
    await askWithBtw("CHOICES before the switch");
    await expect(sideAnswers().last()).toContainText("mode plan");
    await expect(switched()).toHaveValue("read-only");
    await switched().selectOption({ label: "Can change files" });
    await expect(label()).toHaveText("Can change files");
    await askInSideChat("CHOICES after the switch");
    await expect(sideAnswers().last()).toContainText("mode default");
    expect(agentSaw()).toContain("The user switched what this side chat may do.");
    await askInSideChat('TOOLS [{"kind":"edit","title":"Fix the typo"}]');
    const permission = page.locator(".permission.pending:visible");
    await expect(permission).toHaveCount(1);
    await permission.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(sideAnswers().last()).toHaveText("Fix the typo: reject");
  });

  await test.step("it and its conversation keep the choice after a reload, and the next side chat starts with it", async () => {
    await page.reload();
    await expect(label()).toHaveText("Can change files");
    await sideChat().getByRole("button", { name: "New question" }).click();
    await expect(sideChat().locator(".side-chat-heading h2")).toHaveText("New question");
    await expect(label()).toHaveText("Can change files");
    await page.keyboard.press("Alt+KeyB");
    await askWithBtw("CHOICES of the next one");
    await expect(sideAnswers().last()).toContainText("mode default");
    await expect(label()).toHaveText("Can change files");
  });

  await test.step("switched back to read-only while it works, what its agent waits for is turned down, and it is in plan mode again", async () => {
    await askInSideChat('TOOLS [{"kind":"execute","title":"Run rm -rf build"}]');
    await expect(page.locator(".permission.pending:visible")).toHaveCount(1);
    await switched().selectOption({ label: "Read-only" });
    await expect(sideAnswers().last()).toHaveText("Run rm -rf build: reject");
    await expect(page.locator(".permission.pending:visible")).toHaveCount(0);
    await expect(label()).toHaveText("Read-only");
    await askInSideChat("CHOICES back again");
    await expect(sideAnswers().last()).toContainText("mode plan");
  });

  await test.step("the conversation's other side chat stays as it was left", async () => {
    await sidebarRow(mainId).locator(".delegated-toggle").click();
    await page.locator(".workspace li.side-chat-row").filter({ hasText: "CHOICES before the switch" }).click();
    await expect(sideChat().locator(".side-chat-heading h2")).toHaveText("CHOICES before the switch");
    await expect(label()).toHaveText("Can change files");
  });

  await test.step("chosen for the next question before it is asked", async () => {
    await sideChat().getByRole("button", { name: "New question" }).click();
    await expect(label()).toHaveText("Read-only");
    await switched().selectOption({ label: "Can change files" });
    await expect(label()).toHaveText("Can change files");
    await page.keyboard.press("Alt+KeyB");
    await askWithBtw("CHOICES as chosen beforehand");
    await expect(sideAnswers().last()).toContainText("mode default");
  });
});

const canvas = () => page.locator(".canvas-panel:visible");
const canvasPageHeading = () => page.frameLocator(".canvas-panel:visible .canvas-frame.show iframe").locator("h1");
const canvasSwitch = () => page.locator(".canvas-switch:visible");
const switchTo = (name: "Main chat" | "Side chat") => canvasSwitch().getByRole("button", { name });
const showPage = (title: string) => `CANVAS show ${JSON.stringify({ title, html: `<h1>${title}</h1>` })}`;
const askOnCanvas = (question: string) => `CANVAS ask ${JSON.stringify({ question, options: [{ label: "Upload it" }, { label: "Leave it" }] })}`;

async function sendIn(chat: Locator, text: string) {
  const composer = chat.locator(".composer textarea");
  await composer.fill(text);
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
}

async function startWithMainPageAndSideChat() {
  const mainId = await startOn("Forks");
  await sendMessage(page, showPage("Main page"));
  await expect(canvasPageHeading()).toHaveText("Main page");
  await waitForTurnToEnd(page);
  await askWithBtw("SAY ready");
  await expect(sideAnswers().last()).toHaveText("ready");
  return mainId;
}

test("what a side chat asks and shows comes up on the canvas, which goes back to the conversation's once its question is answered", async () => {
  const mainId = await startWithMainPageAndSideChat();
  const question = canvas().locator(".ask h3");
  await expect(canvasSwitch(), "a side chat with nothing on its canvas leaves the pane to its conversation").toHaveCount(0);

  await sendIn(sideChat(), askOnCanvas("Replace the guide?"));
  await expect(question).toHaveText("Replace the guide?");
  await expect(switchTo("Side chat")).toHaveAttribute("aria-pressed", "true");

  await test.step("the user looks at the conversation's canvas and back, and is told that the question still waits", async () => {
    await switchTo("Main chat").click();
    await expect(canvasPageHeading()).toHaveText("Main page");
    await expect(switchTo("Side chat")).toContainText("needs your answer");
    await switchTo("Side chat").click();
    await expect(question).toHaveText("Replace the guide?");
  });

  await test.step("a page the conversation shows meanwhile leaves the question in front", async () => {
    await sendIn(mainChat(), showPage("Newer page"));
    await waitForTurnToEnd(page);
    await expect(question).toHaveText("Replace the guide?");
  });

  await test.step("its answer goes to the side chat's agent, and the conversation's newer page takes the canvas", async () => {
    await canvas().getByRole("radio", { name: "Upload it" }).check();
    await canvas().getByRole("button", { name: "Submit" }).click();
    await expect(sideAnswers().last()).toContainText("Upload it");
    await expect(mainChat().locator(".timeline")).not.toContainText("Upload it");
    await expect(canvasPageHeading()).toHaveText("Newer page");
    await expect(switchTo("Main chat")).toHaveAttribute("aria-pressed", "true");
  });

  await test.step("a page it shows comes up too, until the side chat is put away, and again once it is back", async () => {
    await sendIn(sideChat(), showPage("Side page"));
    await expect(canvasPageHeading()).toHaveText("Side page");
    await sideChat().getByRole("button", { name: "Close side chat" }).click();
    await expect(canvasPageHeading()).toHaveText("Newer page");
    await expect(canvasSwitch()).toHaveCount(0);
    const row = page.locator(".workspace li.side-chat-row", { hasText: "SAY ready" });
    if (!(await row.isVisible())) await sidebarRow(mainId).locator(".delegated-toggle").click();
    await row.click();
    await expect(canvasPageHeading()).toHaveText("Side page");
  });
});

test("a hidden canvas comes back with what a side chat asks", async () => {
  await startWithMainPageAndSideChat();
  await canvas().locator(".canvas-hide").click();
  await expect(canvas()).toHaveCount(0);
  await sendIn(sideChat(), askOnCanvas("Leave it as it is?"));
  await expect(canvas().locator(".ask h3")).toHaveText("Leave it as it is?");
});

test("there is nothing to switch beside an agent that can't be held to reading", async () => {
  await startOn("Fresh");
  await sendMessage(page, "SAY deploys go out on Tuesdays");
  await waitForTurnToEnd(page);
  await askWithBtw("SAY noted");
  await expect(sideChat().locator(".side-chat-access")).toHaveText("Can change files");
  await expect(sideChat().getByLabel("What this side chat may do")).toHaveCount(0);
});
