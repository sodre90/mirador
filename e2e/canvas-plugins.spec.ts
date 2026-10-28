import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, callCanvasTool, chooseInSettings, createProfile, openProfiles, primaryModifier, reloadFromRestartedHost, sendMessage, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";
import type { DesktopMenuMessage } from "../shared/desktop-menu.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const profileName = "board";
const boardFolder = join(host.dataDir, "plugins", "board");
const agentSaw = () => readFileSync(promptsFile, "utf8");

/** An opencode stand-in that is an agent of its own, taking prompts and ending its turns at once. */
function fakeOpencode() {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
}

test.beforeAll(async () => {
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), boardFolder, { recursive: true });
  fakeOpencode();
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const canvasTitle = (page: Page) => page.locator(".canvas-header:visible .canvas-title");
const canvasKind = (page: Page) => page.locator(".canvas-header:visible .canvas-kind");
const toggle = (page: Page) => page.locator(".checklist-toggle:visible");
const pageView = (page: Page) => page.frameLocator(".canvas-panel:visible .canvas-body > .canvas-frame.plugin iframe");
const canvasPane = (page: Page) => page.locator('[data-pane="canvas"]');
const tabView = (page: Page) => page.frameLocator(".checklist:visible .canvas-frame.plugin iframe");
const delegatedTask = (page: Page, title: string) => page.locator(".delegated-tasks:visible li", { hasText: title });

/** The report opens with room, so after a reload the canvas can cover the chat again; the user goes back to the message box. */
/** Waits for the canvas first: a page loaded from a restarted host shows it, full screen again, only a moment later. */
async function backToTheMessageBox(page: Page) {
  const shownCanvas = canvasPane(page).filter({ visible: true });
  await expect(shownCanvas).toHaveCount(1);
  await page.keyboard.press(`${await primaryModifier(page)}+Shift+ArrowLeft`);
  await expect(shownCanvas).not.toHaveClass(/fullscreen/);
}

/** The stub agent offers no model to pick, so this is `startConversation` without that wait. */
async function startConversationWithoutModel(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

async function sendAndWait(page: Page, text: string) {
  await sendMessage(page, text);
  await expect(page.locator(".chat-header:visible .badge")).toHaveText("idle", { timeout: 60_000 });
}

test("a plugin's tools show its items on the canvas and in the tab, its view takes the user's actions, and the agent hears of them", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const conversationId = await startConversationWithoutModel(page);
  await sendAndWait(page, "Start");

  await test.step("the plugin's tool shows a card among the canvas's pages, drawn by the plugin's view", async () => {
    expect(await callCanvasTool(host, conversationId, "show_card", { title: "Hello", text: "First" })).toMatch(/^Shown as [0-9a-f-]+\.$/);
    await expect(canvasTitle(page)).toHaveText("Hello");
    await expect(canvasKind(page)).toHaveText("▤");
    await expect(pageView(page).locator("#title")).toHaveText("Hello");
    await expect(pageView(page).locator("#text")).toHaveText("First (pressed 0 times)");
  });

  await test.step("another tool changes the card in place", async () => {
    expect(await callCanvasTool(host, conversationId, "change_card", { text: "Second" })).toBe("Changed.");
    await expect(pageView(page).locator("#text")).toHaveText("Second (pressed 0 times)");
    await expect(page.getByRole("button", { name: "History (1)" })).toBeVisible();
  });

  await test.step("the user's action in the view reaches the plugin, and its reply or refusal comes back", async () => {
    await pageView(page).getByRole("button", { name: "Press" }).click();
    await expect(pageView(page).locator("#reply")).toHaveText("Pressed 1 times");
    await expect(pageView(page).locator("#text")).toHaveText("Second (pressed 1 times)");
    await pageView(page).getByRole("button", { name: "Do what cards don't" }).click();
    await expect(pageView(page).locator("#reply")).toHaveText("A card can only be pressed.");
  });

  await test.step("the view looks like Mirador: its colours and font scale reach it, and follow a change", async () => {
    const themed = pageView(page).locator("#theme");
    const panelText = await page.locator(".canvas-panel:visible").evaluate((panel) => getComputedStyle(panel).color);
    await expect(themed).toHaveCSS("color", panelText);
    await expect(themed).toHaveCSS("font-size", "10px");
    await chooseInSettings(page, "Text size", "140%");
    await expect(themed).toHaveCSS("font-size", "14px");
    await chooseInSettings(page, "Text size", "100%");
  });

  await test.step("a hint in the view shows as Mirador's own, and a link in it opens in a new tab", async () => {
    await pageView(page).locator("#hinted").hover();
    await expect(page.getByRole("tooltip")).toHaveText("What the board says about itself.");
    const viewBox = (await page.locator(".canvas-panel:visible .canvas-body > .canvas-frame.plugin").boundingBox())!;
    const hintBox = (await page.getByRole("tooltip").boundingBox())!;
    expect(hintBox.y).toBeGreaterThan(viewBox.y);
    await page.context().route("https://example.invalid/board", (route) => route.fulfill({ body: "The board's site" }));
    const opened = page.context().waitForEvent("page");
    await pageView(page).getByRole("link", { name: "The board's site" }).click();
    expect((await opened).url()).toBe("https://example.invalid/board");
  });

  await test.step("inside the desktop app, a link in the view opens in the browser through the app", async () => {
    await page.addInitScript(() => {
      const sent: DesktopMenuMessage[] = [];
      Object.assign(window, { sentToDesktopApp: sent });
      window.__electrobunSendToHost = (message) => {
        sent.push(message);
        if (message.type === "desktop-nonce-request") setTimeout(() => window.dispatchEvent(new CustomEvent("mirador:desktop-nonce", { detail: "nonce-1" })));
      };
    });
    await page.reload();
    const pagesBefore = page.context().pages().length;
    await pageView(page).getByRole("link", { name: "The board's site" }).click();
    const openedLinks = async () =>
      (await page.evaluate(() => (window as unknown as { sentToDesktopApp: DesktopMenuMessage[] }).sentToDesktopApp)).filter(({ type }) => type === "desktop-open-link");
    await expect.poll(openedLinks).toEqual([{ type: "desktop-open-link", nonce: "nonce-1", url: "https://example.invalid/board" }]);
    expect(page.context().pages()).toHaveLength(pagesBefore);
  });

  await test.step("the agent hears of the presses with the next message, once", async () => {
    await sendAndWait(page, "Carry on");
    expect(agentSaw()).toContain('The user pressed the card "Hello" 1 times.\n\nCarry on\n');
    await sendAndWait(page, "And again");
    expect(agentSaw().endsWith("Carry on\nAnd again\n")).toBe(true);
  });

  await test.step("an item for the tab opens there, with its count on the toggle and its icon and title in the header", async () => {
    await callCanvasTool(host, conversationId, "track_steps", { title: "Release", steps: ["Build", "Ship"] });
    await expect(toggle(page)).toHaveText("Checklist 0/2");
    await expect(canvasTitle(page)).toHaveText("Release");
    await expect(canvasKind(page)).toHaveText("◔");
    await expect(tabView(page).locator("#text")).toHaveText("0 of 2 steps done");
    await callCanvasTool(host, conversationId, "finish_step", {});
    await expect(toggle(page)).toHaveText("Checklist 1/2");
    await expect(tabView(page).locator("#text")).toHaveText("1 of 2 steps done");
    await expect(page.getByRole("button", { name: "History (1)" })).toBeVisible();
  });

  await test.step("the view knows which of the agent's changes the user hasn't seen yet", async () => {
    await expect(tabView(page).locator("#unseen")).toHaveText("Changed since you looked");
    await page.getByRole("button", { name: "Close the checklist" }).click();
    await toggle(page).click();
    await expect(tabView(page).locator("#unseen")).toHaveText("Nothing new");
    await page.getByRole("button", { name: "Close the checklist" }).click();
    await callCanvasTool(host, conversationId, "finish_step", {});
    await expect(toggle(page)).toHaveText("Checklist 2/2");
    await toggle(page).click();
    await expect(tabView(page).locator("#unseen")).toHaveText("Changed since you looked");
  });

  await test.step("dismissing takes the item out of the tab, and the plugin knows", async () => {
    await page.getByRole("button", { name: "Dismiss the checklist" }).click();
    await expect(toggle(page)).toHaveCount(0);
    await expect(canvasTitle(page)).toHaveText("Hello");
    await page.reload();
    await expect(toggle(page)).toHaveCount(0);
    expect(await callCanvasTool(host, conversationId, "finish_step", {})).toBe("There are no steps to tick off.");
    await expect(canvasKind(page)).toHaveText("▤");
  });

  await test.step("an item that opens with room takes the full screen as a review does, with what came of it in the bar", async () => {
    await callCanvasTool(host, conversationId, "show_report", { title: "Report", verdict: "Approve" });
    await expect(canvasPane(page)).toHaveClass(/fullscreen/);
    await expect(pageView(page).locator("#text")).toHaveText("Verdict: Approve");
    await expect(page.locator(".canvas-header:visible .canvas-outcome")).toHaveText("Approve");
    await callCanvasTool(host, conversationId, "change_verdict", { verdict: "Request changes" });
    await expect(page.locator(".canvas-header:visible .canvas-outcome")).toHaveText("Request changes");
  });

  await test.step("the view knows whether the canvas fills the workspace, and changes that", async () => {
    await expect(pageView(page).locator("#fullscreen")).toHaveText("Full screen");
    await pageView(page).getByRole("button", { name: "Toggle full screen" }).click();
    await expect(canvasPane(page)).not.toHaveClass(/fullscreen/);
    await expect(pageView(page).locator("#fullscreen")).toHaveText("Beside the chat");
    await pageView(page).getByRole("button", { name: "Toggle full screen" }).click();
    await expect(canvasPane(page)).toHaveClass(/fullscreen/);
    await pageView(page).getByRole("button", { name: "Toggle full screen" }).click();
    await expect(canvasPane(page)).not.toHaveClass(/fullscreen/);
  });

  await test.step("the find shortcut reaches the view that has focus, and finds in the conversation elsewhere", async () => {
    const mod = await primaryModifier(page);
    await pageView(page).locator("#title").click();
    await page.keyboard.press(`${mod}+KeyF`);
    await expect(pageView(page).locator("#found")).toHaveText("Found 1 times");
    await expect(page.getByRole("textbox", { name: "Find in this conversation" })).toHaveCount(0);
    await page.locator(".composer:visible textarea").click();
    await page.keyboard.press(`${mod}+KeyF`);
    await expect(page.getByRole("textbox", { name: "Find in this conversation" })).toBeFocused();
    await expect(pageView(page).locator("#found")).toHaveText("Found 1 times");
    await page.keyboard.press("Escape");
  });

  await test.step("the view sends the agent a message as the composer does, and follows Settings for typing", async () => {
    await pageView(page).getByRole("textbox", { name: "Question" }).fill("What about the cache?");
    await pageView(page).getByRole("button", { name: "Ask the agent" }).click();
    await expect(pageView(page).locator("#asked")).toHaveText("Asked");
    await expect.poll(agentSaw).toContain("What about the cache?\n");
    await expect(pageView(page).locator("#typing")).toHaveText("Autocorrect off");
    await page.evaluate(() => localStorage.setItem("mirador-typing-aids", JSON.stringify({ autocorrect: true, predictions: false })));
    await page.reload();
    await expect(pageView(page).locator("#typing")).toHaveText("Autocorrect on");
  });

  await test.step("the plugin's tool hands a task to a conversation on another profile, whose reply comes back as the next message", async () => {
    const profiles = await createProfile(page, "Local", "", "", "opencode");
    await profiles.getByRole("button", { name: "Close" }).click();
    expect(await callCanvasTool(host, conversationId, "hand_over", { profile: "nope", task: "SAY Found 3 callers." })).toMatch(/^There is no profile named nope; the profiles are .*Local/);

    expect(await callCanvasTool(host, conversationId, "hand_over", { profile: "local", task: "SAY Found 3 callers." })).toMatch(/^Handed over to [0-9a-f-]+\.$/);
    await expect(page.locator(`.sidebar li[data-reorder-id="${conversationId}"]`).getByRole("button", { name: "1 delegated" })).toBeVisible();
    await expect.poll(agentSaw).toContain("The handed-over task finished: Found 3 callers.\n");
  });

  await test.step("the handed-over task shows above the caller's composer with the start of its reply, and folded under the caller in the sidebar, until dismissed", async () => {
    await backToTheMessageBox(page);
    const fromBoard = page.locator(".timeline-entry:visible", { has: page.locator(".author", { hasText: "From Board" }) }).locator(".message.user");
    await expect(fromBoard, "the reply is the plugin's message, not the user's").toContainText("The handed-over task finished: Found 3 callers.");
    await page.locator(".composer:visible textarea").press("ArrowUp");
    await expect(page.locator(".composer:visible textarea"), "↑ brings back the user's last message, skipping the plugin's").toHaveValue("What about the cache?");
    await page.locator(".composer:visible textarea").fill("");
    const task = delegatedTask(page, "SAY Found 3 callers.");
    await expect(task.locator(".delegated-task-text > span").first()).toHaveText("Finished: SAY Found 3 callers. on Local");
    await expect(task.locator(".delegated-task-detail")).toHaveText("Found 3 callers.");
    const callerRow = page.locator(`.sidebar li[data-reorder-id="${conversationId}"]`);
    const fold = callerRow.getByRole("button", { name: "1 delegated" });
    await expect(fold).toHaveText("▸ 1");
    await expect(page.locator(".sidebar li.under-caller")).toHaveCount(0);
    await fold.click();
    await expect(fold).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`.sidebar li[data-reorder-id="${conversationId}"] + li.under-caller`)).toContainText("SAY Found 3 callers.");
    await fold.click();
    await expect(page.locator(".sidebar li.under-caller")).toHaveCount(0);

    await task.getByRole("button", { name: "SAY Found 3 callers." }).click();
    await expect(page.locator(".chat-header:visible")).toContainText("SAY Found 3 callers.");
    await expect(page.locator(".sidebar li.under-caller.selected"), "opening a folded delegated conversation unfolds it").toContainText("SAY Found 3 callers.");
    await expect(page.locator(".chat-header:visible").getByLabel("Hand over to", { exact: true }), "a handed-over conversation can't hand over in turn").toHaveCount(0);
    await page.evaluate((caller) => (location.hash = `#/c/${caller}`), conversationId);
    await task.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.locator(".delegated-tasks:visible")).toHaveCount(0);
    await expect(page.locator(".sidebar").getByText("SAY Found 3 callers.")).toHaveCount(0);
    await expect(callerRow.locator(".delegated-toggle")).toHaveCount(0);
  });

  await test.step("a reply that comes while the caller's agent works waits in the queue, tagged with the plugin's title", async () => {
    const release = join(host.root, "release-caller");
    await sendMessage(page, `WRITE ${JSON.stringify([{ waitFor: release }])}`);
    await expect(page.locator(".chat-header:visible .badge")).not.toHaveText("idle");
    expect(await callCanvasTool(host, conversationId, "hand_over", { profile: "local", task: "SAY Found 4 callers." })).toMatch(/^Handed over to [0-9a-f-]+\.$/);
    const queued = page.locator("li.queued:visible");
    await expect(queued.locator(".queued-source")).toHaveText("Board");
    await expect(queued.locator(".queued-text")).toHaveText("The handed-over task finished: Found 4 callers.");
    writeFileSync(release, "");
    await expect(queued).toHaveCount(0);
    await expect(page.locator(".timeline-entry:visible .message.user").last()).toHaveText("The handed-over task finished: Found 4 callers.");
    await delegatedTask(page, "SAY Found 4 callers.").getByRole("button", { name: "Dismiss" }).click();
    await expect(page.locator(".delegated-tasks:visible")).toHaveCount(0);
  });

  await test.step("a reply over several lines keeps its line breaks above the composer, without the blank ones", async () => {
    expect(await callCanvasTool(host, conversationId, "hand_over", { profile: "local", task: "SAY Found 2 callers:\n\n- in a.ts\n- in b.ts" })).toMatch(/^Handed over to [0-9a-f-]+\.$/);
    const task = delegatedTask(page, "SAY Found 2 callers:");
    await expect.poll(() => task.locator(".delegated-task-detail").innerText()).toBe("Found 2 callers:\n- in a.ts\n- in b.ts");
    await task.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.locator(".delegated-tasks:visible")).toHaveCount(0);
  });

  await test.step("a handed-over task that a restart cuts short carries on after it, and Stop above the composer ends it, which the caller's agent hears", async () => {
    const title = "STOPPED QUIET Look for the callers";
    const timesSent = () => agentSaw().split(title).length - 1;
    expect(await callCanvasTool(host, conversationId, "hand_over", { profile: "local", task: title })).toMatch(/^Handed over to [0-9a-f-]+\.$/);
    const task = delegatedTask(page, title);
    await expect(task.locator(".delegated-task-text > span").first()).toHaveText(new RegExp(`^Working: ${title} on Local for \\d+ s$`));
    await expect.poll(timesSent).toBe(1);
    const detailHeight = () => task.locator(".delegated-task-detail").evaluate((line) => line.getBoundingClientRect().height);
    expect(await detailHeight(), "a working task keeps the line its tool calls show in, so the row doesn't jump between them").toBeGreaterThan(0);

    const runningBefore = host.log.match(/Mirador is running/g)?.length ?? 0;
    const loadedFromTheNextHost = page.waitForEvent("load", { timeout: 60_000 });
    await page.keyboard.press(`${await primaryModifier(page)}+Shift+R`);
    await expect.poll(() => host.log.match(/Mirador is running/g)?.length, { timeout: 60_000 }).toBe(runningBefore + 1);
    await loadedFromTheNextHost;
    await expect.poll(timesSent, { message: "the next host sends the task's turn again" }).toBe(2);
    expect(agentSaw(), "the turn the restart stopped is no reply yet").not.toContain("The handed-over task stopped");

    await backToTheMessageBox(page);
    await task.getByRole("button", { name: "Stop", exact: true }).click();
    await expect.poll(agentSaw).toContain("The handed-over task stopped: no reply\n");
    await expect(task.locator(".delegated-task-text > span").first()).toHaveText(`Stopped: ${title} on Local`);
  });

  await test.step("deleting a handed-over task's conversation before it ends tells the caller's agent it stopped, and no plugin's conversation starts another", async () => {
    const title = "STOPPED QUIET Delete me";
    const handedOver = await callCanvasTool(host, conversationId, "hand_over", { profile: "local", task: title });
    const startedId = handedOver.match(/^Handed over to ([0-9a-f-]+)\.$/)![1]!;
    expect(await callCanvasTool(host, startedId, "hand_over", { profile: "local", task: "SAY Again" })).toBe("A plugin's tool started this conversation, so it can't start another; do the task here.");
    await expect.poll(() => agentSaw().split(title).length - 1).toBe(1);

    const row = page.locator(".sidebar li.under-caller", { hasText: title });
    const deleteButton = row.getByRole("button", { name: "Delete conversation" });
    await row.hover();
    await deleteButton.click();
    await expect(deleteButton).toHaveText("Delete?");
    await deleteButton.click();
    await expect.poll(() => agentSaw().split("The handed-over task stopped: no reply\n").length - 1).toBe(2);
    await expect(delegatedTask(page, title)).toHaveCount(0);
  });

  await test.step("a plugin's profile setting shows in the Profiles dialog, offering the other profiles, and its tool takes what the profile chose", async () => {
    const dialog = await openProfiles(page);
    await dialog.locator(".profile-list li", { hasText: profileName }).click();
    const handOverTo = dialog.getByLabel("Profile Hand over to");
    await expect(handOverTo).toHaveValue("");
    await expect(handOverTo.locator("option").first()).toHaveText("None");
    await expect(handOverTo.locator("option", { hasText: "Local" })).toHaveCount(1);
    await expect(handOverTo.locator("option", { hasText: profileName }), "a profile doesn't hand over to itself").toHaveCount(0);
    await handOverTo.selectOption({ label: "Local" });
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.locator(".saved")).toHaveText("Saved");
    await dialog.getByRole("button", { name: "Close" }).click();
    const reopened = await openProfiles(page);
    await reopened.locator(".profile-list li", { hasText: profileName }).click();
    await expect(reopened.getByLabel("Profile Hand over to").locator("option:checked")).toHaveText("Local");
    await reopened.getByRole("button", { name: "Close" }).click();

    expect(await callCanvasTool(host, conversationId, "hand_over", { task: "SAY Handed over by default." })).toMatch(/^Handed over to [0-9a-f-]+\.$/);
    await expect.poll(agentSaw).toContain("The handed-over task finished: Handed over by default.\n");
  });

  await test.step("the conversation's top bar picks its own choice for a plugin's profile setting, which its tool takes and its agent hears of; Profile's follows the profile again", async () => {
    await backToTheMessageBox(page);
    const handOverTo = page.locator(".chat-header:visible").getByLabel("Hand over to", { exact: true });
    await expect(handOverTo.locator("option:checked")).toHaveText("Profile's (Local)");
    await handOverTo.selectOption({ label: "None" });
    await expect.poll(() => callCanvasTool(host, conversationId, "hand_over", { task: "SAY Not handed over." })).toBe("Name a profile; this one hands over to none.");
    await sendAndWait(page, "SAY Noted.");
    expect(agentSaw()).toContain("Hand over to for this conversation is now none: the user chose it, in place of what your instructions say of it.\n\nSAY Noted.");

    await handOverTo.selectOption({ label: "Profile's (Local)" });
    await expect.poll(() => callCanvasTool(host, conversationId, "hand_over", { task: "SAY Handed over again." })).toMatch(/^Handed over to [0-9a-f-]+\.$/);
    await expect.poll(agentSaw, "the handed-over task ends before the switch, so its end isn't the prompt that tells of it").toContain("The handed-over task finished: Handed over again.\n");

    await handOverTo.selectOption({ label: "None" });
    await expect(handOverTo.locator("option:checked")).toHaveText("None");
    await page.getByLabel("Profile", { exact: true }).filter({ visible: true }).selectOption({ label: "Local" });
    await expect(handOverTo.locator("option:checked"), "switching profile goes back to following it").toHaveText("Profile's (None)");
    await sendAndWait(page, "SAY Switched.");
    expect(agentSaw(), "the agent hears the setting as it is after the switch").toContain("Hand over to for this conversation is back to its profile's: none.\n\nSAY Switched.");
  });

  await test.step("a plugin's tool call in the conversation names the plugin, where Mirador's own canvas tools name the canvas", async () => {
    await backToTheMessageBox(page);
    const calls = [
      { title: "mcp__canvas__hand_over", kind: "other", rawInput: { task: "Find the callers" } },
      { title: "mcp__canvas__show", kind: "other", rawInput: { title: "Plan" } },
    ];
    await sendAndWait(page, `RUN TOOLS ${JSON.stringify(calls)}`);
    await expect(page.locator(".timeline:visible .tool-title").filter({ hasText: "hand_over" })).toHaveText("Board · hand_over");
    await expect(page.locator(".timeline:visible .tool-title").filter({ hasText: " · show" })).toHaveText("canvas · show");
  });

  await test.step("with the plugin gone, its item shows what it published instead of a blank page", async () => {
    rmSync(boardFolder, { recursive: true });
    await host.restart();
    await reloadFromRestartedHost(page);
    await expect(canvasTitle(page)).toHaveText("Report");
    await expect(page.locator(".canvas-panel:visible .plugin-item-missing")).toContainText("The board plugin isn't installed, so this is what it published, as it is.");
    await expect(page.locator(".canvas-panel:visible .plugin-item-missing pre")).toContainText('"verdict": "Request changes"');
  });
});
