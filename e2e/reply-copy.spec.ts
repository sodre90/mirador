import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, reloadFromRestartedHost, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const BEFORE = "Pulling **main** now.";
const AFTER = "I pulled `main`:\n\n- 128 files changed\n- the new tag v0.11.0";
const NEXT = "You're welcome.";
const LATER = "The build you started has finished.";

const agentText = (text: string) => ({ type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
const turns = [
  { type: "user-message", text: "git pull" },
  agentText(BEFORE),
  { type: "acp", update: { sessionUpdate: "tool_call", toolCallId: "pull", title: "Pull latest changes from remote", kind: "execute", status: "completed" } },
  agentText(AFTER),
  { type: "turn-end", stopReason: "end_turn" },
  { type: "user-message", text: "thanks" },
  agentText(NEXT),
  { type: "turn-end", stopReason: "end_turn" },
  agentText(LATER),
  { type: "turn-end", stopReason: "end_turn" },
];

/** Chromium on Windows puts text on the clipboard with Windows line breaks, as pasting there expects. */
const asCopied = (text: string) => (process.platform === "win32" ? text.replaceAll("\n", "\r\n") : text);

/** Null while the browser is still writing it, when reading says the clipboard data changed. */
const clipboard = (page: Page) =>
  page.evaluate(async () => {
    try {
      const [item] = await navigator.clipboard.read();
      const read = async (type: string) => (item!.types.includes(type) ? (await item!.getType(type)).text() : null);
      return { text: await read("text/plain"), html: await read("text/html") };
    } catch {
      return null;
    }
  });

test("a turn's whole reply copies as formatted text with its Markdown, or as Markdown alone, without the tools between", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "seed-events.ts"), join(host.dataDir, "state.sqlite"), conversationId, JSON.stringify(turns)]);
  await host.start();
  await reloadFromRestartedHost(page);

  const replies = page.locator(".message.agent");
  await expect(replies).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Copy reply", exact: true }), "only a turn's last text offers it").toHaveCount(3);
  const [firstTurn, secondTurn] = ["128 files changed", NEXT].map((text) => page.locator(".timeline-entry").filter({ hasText: text }));
  const copyReply = firstTurn.getByRole("button", { name: "Copy reply", exact: true });
  const copyMarkdown = firstTurn.getByRole("button", { name: "Copy reply as Markdown" });

  await test.step("the buttons float on the reply's edge while the pointer is over it, taking no room", async () => {
    const toolbar = firstTurn.locator(".copy-reply");
    await expect(toolbar).toHaveCSS("opacity", "0");
    expect((await firstTurn.locator(".reply-actions").boundingBox())!.height, "with read aloud off, the row under the reply is empty").toBe(0);
    await firstTurn.hover();
    await expect(toolbar).toHaveCSS("opacity", "1");
    await expect(copyReply).toBeVisible();
    await expect(copyMarkdown).toBeVisible();
  });

  await test.step("Copy reply puts the turn's text on the clipboard formatted, with its Markdown as the plain text", async () => {
    await copyReply.click();
    await expect(firstTurn.getByRole("button", { name: "Copied" })).toBeVisible();
    await expect.poll(async () => (await clipboard(page))?.text).toBe(asCopied(`${BEFORE}\n\n${AFTER}`));
    const copied = (await clipboard(page))!;
    expect(copied.html).toContain("<strong>main</strong>");
    expect(copied.html).toContain("<code>main</code>");
    expect(copied.html).toContain("<li>128 files changed</li>");
    expect(copied.html).not.toContain("Pull latest changes");
    await expect(firstTurn.getByRole("button", { name: "Copy reply", exact: true }), "and goes back to Copy reply").toBeVisible();
  });

  await test.step("Copy reply as Markdown puts only the Markdown on the clipboard", async () => {
    await firstTurn.hover();
    await copyMarkdown.click();
    await expect.poll(() => clipboard(page)).toEqual({ text: asCopied(`${BEFORE}\n\n${AFTER}`), html: null });
  });

  await test.step("the next turn copies only its own reply", async () => {
    await secondTurn.hover();
    await secondTurn.getByRole("button", { name: "Copy reply as Markdown" }).click();
    await expect.poll(() => clipboard(page)).toEqual({ text: NEXT, html: null });
  });

  await test.step("a turn the agent begins by itself, with no message, is a reply of its own", async () => {
    const laterTurn = page.locator(".timeline-entry").filter({ hasText: LATER });
    await expect(page.locator(".message.agent").filter({ hasText: NEXT }), "it doesn't run on from the turn before").not.toContainText(LATER);
    await laterTurn.hover();
    await laterTurn.getByRole("button", { name: "Copy reply as Markdown" }).click();
    await expect.poll(() => clipboard(page)).toEqual({ text: LATER, html: null });
  });

  await test.step("where the browser refuses the clipboard write, a copy command copies it instead", async () => {
    await page.evaluate(() => {
      navigator.clipboard.write = () => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError"));
      const copied: string[] = [];
      Object.assign(window, { copied });
      window.addEventListener("copy", (event) => copied.push(event.clipboardData!.getData("text/plain")));
    });
    await firstTurn.hover();
    await copyMarkdown.click();
    await expect(firstTurn.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual([`${BEFORE}\n\n${AFTER}`]);
  });

  await test.step("without the clipboard API, as over plain http, a copy command copies both formats, and a refused one says so", async () => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: undefined });
      const copied: Record<string, string>[] = [];
      Object.assign(window, { copied });
      window.addEventListener("copy", (event) => copied.push({ text: event.clipboardData!.getData("text/plain"), html: event.clipboardData!.getData("text/html") }));
    });
    await page.reload();
    await firstTurn.hover();
    await copyReply.click();
    await expect(firstTurn.getByRole("button", { name: "Copied" })).toBeVisible();
    const [copied] = await page.evaluate(() => (window as unknown as { copied: { text: string; html: string }[] }).copied);
    expect(copied!.text).toBe(`${BEFORE}\n\n${AFTER}`);
    expect(copied!.html).toContain("<li>128 files changed</li>");

    await page.evaluate(() => (document.execCommand = () => false));
    await firstTurn.hover();
    await copyMarkdown.click();
    await expect(firstTurn.getByRole("alert")).toHaveText("Couldn't copy");
    await expect(firstTurn.getByRole("alert"), "and goes after a moment").toHaveCount(0);
  });
});
