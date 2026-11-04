import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { addWorkspace, currentMatch, reloadFromRestartedHost, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const LINK = "https://chrome-devtools-frontend.appspot.com/serve_rev/@d04cdb24/inspector.html?wss=192.168.1.160:19555/devtools/page/AB12";
const COMMANDS = "./infra/cdp_tls.sh\ntools/pod_devtools.sh 9555";
/** Chromium on Windows puts text on the clipboard with Windows line breaks, as pasting there expects. */
const COMMANDS_AS_COPIED = process.platform === "win32" ? COMMANDS.replaceAll("\n", "\r\n") : COMMANDS;
const PORT_CODE = 'const port = 9555; // the pod\'s\nconnect("devtools", port);';
const reply = ["Open the link:", "", "```", LINK, "```", "", "Then run `tools/pod_devtools.sh 9333`, or copy both at once:", "", "```bash", COMMANDS, "```"].join("\n");
const later = ["The port is set here:", "", "```ts", PORT_CODE, "```", "", "The README says:", "", "````markdown", "Run:", "```bash", "bun test", "```", "````"].join("\n");

const turn = [
  { type: "user-message", text: "how do I open DevTools on the pod" },
  { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: reply } } },
  { type: "turn-end", stopReason: "end_turn" },
  { type: "user-message", text: "where is this set?\n```ts\nconst port = 9555;\n```" },
  { type: "acp", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: later } } },
  { type: "turn-end", stopReason: "end_turn" },
];

const shown = (button: Locator) => expect(button).toHaveCSS("opacity", "1");
const hidden = (button: Locator) => expect(button).toHaveCSS("opacity", "0");

test("each code block in a reply has a Copy button, shown on hover or always on a touch screen, that copies the block's text exactly", async ({
  page,
  context,
  browser,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  await host.stop();
  execFileSync("bun", [join(import.meta.dirname, "seed-events.ts"), join(host.dataDir, "state.sqlite"), conversationId, JSON.stringify(turn)]);
  await host.start();
  await reloadFromRestartedHost(page);

  const message = page.locator(".message.agent").first();
  const [linkBlock, commandsBlock] = [0, 1].map((index) => message.locator(".copyable-code").nth(index));
  const [linkCopy, commandsCopy] = [linkBlock, commandsBlock].map((block) => block.locator(".code-copy"));
  await expect(message).toContainText("tools/pod_devtools.sh 9333");
  await expect(message.locator(".code-copy")).toHaveCount(2);
  await expect(commandsBlock, "a reply ending with a code block ends without a gap").toHaveCSS("margin-bottom", "0px");

  await test.step("the button shows while the pointer is over its block, or Tab is on it", async () => {
    await hidden(linkCopy);
    await linkBlock.hover();
    await shown(linkCopy);
    await expect(linkCopy).toHaveText("Copy");
    await hidden(commandsCopy);

    await page.locator(".chat-header h2").hover();
    await commandsCopy.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(commandsCopy).toBeFocused();
    await shown(commandsCopy);
    await commandsCopy.blur();
  });

  await test.step("a click copies the block's text, without the line break markdown adds, and says so for a moment", async () => {
    await linkBlock.hover();
    await linkCopy.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(LINK);
    await expect(linkCopy).toHaveText("Copied");
    await page.locator(".chat-header h2").hover();
    await shown(linkCopy);
    await expect(linkCopy).toHaveText("Copy");
    await hidden(linkCopy);

    await commandsBlock.hover();
    await commandsCopy.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(COMMANDS_AS_COPIED);
  });

  await test.step("where the browser refuses the copy, the button says so for a moment", async () => {
    await page.evaluate(() => (navigator.clipboard.writeText = () => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError"))));
    await linkBlock.hover();
    await linkCopy.click();
    await expect(linkCopy).toHaveText("Couldn't copy");
    await expect(linkCopy).toHaveText("Copy");
    await page.reload();
  });

  await test.step("the find bar finds the reply's words, not the buttons", async () => {
    await page.keyboard.press("Control+KeyF");
    const bar = page.getByRole("search");
    await bar.getByLabel("Find in this conversation").fill("copy");
    await expect(bar.locator(".find-tally")).toHaveText("1 of 1");
    expect(await currentMatch(page)).toMatchObject({ text: "copy" });
    await page.keyboard.press("Escape");
  });

  await test.step("a code block whose fence names its language is colored as code, in replies and in the person's messages, and copies as written", async () => {
    const tsBlock = page.locator(".message.agent").nth(1).locator(".copyable-code").first();
    const keyword = tsBlock.locator(".token.keyword", { hasText: "const" });
    const comment = tsBlock.locator(".token.comment");
    await expect(keyword).toHaveCount(1);
    await expect(comment).toHaveText("// the pod's");
    const colorOf = (element: Locator) => element.evaluate((node) => getComputedStyle(node).color);
    expect(await colorOf(keyword)).not.toBe(await colorOf(tsBlock.locator("code")));
    expect(await colorOf(comment)).not.toBe(await colorOf(keyword));
    await expect(linkBlock.locator(".token"), "a block without a language stays plain").toHaveCount(0);
    await expect(page.locator(".message.user .copyable-code .token.keyword", { hasText: "const" })).toHaveCount(1);
    const nestedFence = page.locator(".message.agent").nth(1).locator(".token.code-block", { hasText: "bun test" });
    await expect(nestedFence, "a fence inside a markdown block is colored text, not a box of its own").toHaveCSS("border-top-style", "none");

    await tsBlock.hover();
    await tsBlock.locator(".code-copy").click();
    const asCopied = process.platform === "win32" ? PORT_CODE.replaceAll("\n", "\r\n") : PORT_CODE;
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(asCopied);
  });

  await test.step("a touch screen, with no pointer to hover, always shows the buttons", async () => {
    const touchContext = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 1280, height: 800 } });
    const touchPage = await touchContext.newPage();
    await signIn(touchPage, host);
    await touchPage.goto(`${host.origin}/#/c/${conversationId}`);
    expect(await touchPage.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);
    const buttons = touchPage.locator(".message.agent").first().locator(".code-copy");
    await expect(buttons).toHaveCount(2);
    for (const button of await buttons.all()) await shown(button);
    await touchContext.close();
  });

  await test.step("the button speaks the language Mirador is in", async () => {
    await page.evaluate(() => localStorage.setItem("mirador-language", "hu"));
    await page.reload();
    await linkBlock.hover();
    await expect(linkCopy).toHaveText("Másolás");
  });
});
