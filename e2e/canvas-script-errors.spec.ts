import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, answerCanvasQuestion, callCanvasTool, conversationSettings, createProfile, openFromCanvasHistory, sendMessage, signIn } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const promptsFile = join(host.root, "prompts");
const profileName = "page-maker";
const HIDDEN_THROW = "A script on the page threw an error; this browser hides its message.";

// Later tests use the workspace and profile the first one adds.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: promptsFile });
  writeFileSync(promptsFile, "");
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

/** Everything the agent was given, in order; a prompt of several lines is written as it stands. */
const agentSaw = () => readFileSync(promptsFile, "utf8");
const status = (page: Page) => page.locator(".chat-header:visible .badge");
const canvasTitle = (page: Page) => page.locator(".canvas-header:visible .canvas-title");
const pageErrors = (page: Page) => page.locator(".canvas-frame.show .frame-errors li");
const selectInSidebar = (page: Page, conversationId: string) => page.locator(`[data-reorder-id="${conversationId}"]`).click();

/** The stub agent offers no model to pick, so this is `startConversation` without that wait. */
async function startConversationWithoutModel(page: Page) {
  const previousUrl = page.url();
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).not.toHaveURL(previousUrl);
  return page.url().match(/#\/c\/(.+)$/)![1]!;
}

async function sendAndWait(page: Page, text: string) {
  await sendMessage(page, text);
  await expect(status(page)).toHaveText("idle", { timeout: 60_000 });
}

async function setUpAgent(page: Page) {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, profileName, "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
}

async function startWithAgent(page: Page) {
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${profileName} · opencode` });
  const conversationId = await startConversationWithoutModel(page);
  await sendAndWait(page, "Start");
  return conversationId;
}

const PIPE_IN_LABEL = "flowchart TD\n  E[dump] --> F[mongodump | age | s3 cp]";
const SOUND_DIAGRAM = "flowchart TD\n  E[dump] --> F[upload]";
const PIPE_ERROR = /^- Mermaid: Parse error on line 2:/;

const mermaidLibrary = () => `<script src="http://127.0.0.1:${host.port + 1}/mermaid.min.js"></script>`;

const diagramsDrawnOnLoad = (...diagrams: string[]) =>
  `${diagrams.map((diagram) => `<pre class="mermaid">${diagram}</pre>`).join("")}${mermaidLibrary()}<script>mermaid.initialize({ startOnLoad: true });</script>`;

/** Draws the diagrams one after another, each a while after the one before it. */
const diagramsDrawnSlowly = (...diagrams: string[]) =>
  `${diagrams.map((diagram) => `<pre class="mermaid">${diagram}</pre>`).join("")}${mermaidLibrary()}
<script>mermaid.initialize({ startOnLoad: false }); mermaid.run({ querySelector: ".mermaid", postRenderCallback: () => new Promise((drawn) => setTimeout(drawn, 2000)) });</script>`;

const reportedErrors = (result: string) => result.split("\n").filter((line) => line.startsWith("- "));

/** Shows the page until its report comes within the time the tool waits for it, which a busy computer can take longer than. */
async function showUntilReported(conversationId: string, title: string, html: string) {
  let result = "";
  await expect
    .poll(async () => (result = await callCanvasTool(host, conversationId, "show", { title, html })), { timeout: 90_000 })
    .not.toContain("has not finished rendering yet");
  return result;
}

/** The page tells its frame's parent once it has rendered, and the canvas sends its report on the same socket as the next message. */
async function waitForPageToRender(page: Page, open: () => Promise<void>) {
  await page.evaluate(() => {
    const seen = window as unknown as { pageRendered?: boolean };
    seen.pageRendered = false;
    addEventListener("message", (event) => {
      if (event.data?.kind === "rendered") seen.pageRendered = true;
    });
  });
  await open();
  await page.waitForFunction(() => (window as unknown as { pageRendered?: boolean }).pageRendered);
}

test("a page's script errors reach the agent: one the browser hides says so, none comes twice, and a page nobody saw shown tells of them with the next message", async ({ page }) => {
  await setUpAgent(page);
  const conversationId = await startWithAgent(page);

  await test.step("a page shown to the user reports its errors in the tool's result", async () => {
    const assetsOrigin = `http://127.0.0.1:${host.port + 1}`;
    const html = `<p>Charts</p>
<script>draw("c1", [[[1, 2]]]], 200);</script>
<script src="${assetsOrigin}/three/addons/controls/OrbitControls.js"></script>`;

    const result = await callCanvasTool(host, conversationId, "show", { title: "Charts", html });

    const reported = result.split("\n").slice(1);
    expect(result).toContain("but the page reported errors:");
    expect(reported).toHaveLength(2);
    expect(reported[0]).toMatch(/^- Uncaught SyntaxError: .*missing \) after argument list/);
    expect(reported[1]).toBe(`- ${HIDDEN_THROW}`);
    await expect(pageErrors(page)).toHaveText([/SyntaxError: .*missing \) after argument list/, HIDDEN_THROW]);
  });

  await test.step("a page shown while nobody was viewing tells the agent what its first view found, once, with the next message", async () => {
    await startConversationWithoutModel(page);
    const html = `<p>Charts</p>\n<script>draw("c1", [[[1, 2]]]], 200);</script>`;

    let result = "";
    await expect.poll(async () => (result = await callCanvasTool(host, conversationId, "show", { title: "Unseen charts", html }))).toContain("Nobody is viewing");
    expect(result).toContain("if the page reports errors when the user opens it, you will hear of them with their next message.");
    const itemId = result.match(/as item ([\w-]+)\./)![1]!;

    await waitForPageToRender(page, () => selectInSidebar(page, conversationId));
    await expect(canvasTitle(page)).toHaveText("Unseen charts");
    await expect(pageErrors(page)).toHaveText([/SyntaxError: .*missing \) after argument list/]);

    await sendAndWait(page, "Carry on");
    expect(agentSaw()).toMatch(
      new RegExp(
        `The page "Unseen charts" \\(canvas item ${itemId}\\) reported errors after your show call had returned:\\n- Uncaught SyntaxError: [^\\n]*missing \\) after argument list[^\\n]*\\n\\nCarry on\\n`,
      ),
    );
    await expect(canvasTitle(page), "hearing of the errors leaves the canvas where the user had it").toHaveText("Unseen charts");

    await sendAndWait(page, "And on");
    expect(agentSaw().match(/after your show call had returned/g)).toHaveLength(1);
  });
});

test("a Mermaid diagram that can't be drawn reaches the agent once, also one drawn well after the page has loaded, and one drawn fine doesn't", async ({ page }) => {
  await signIn(page, host);
  const conversationId = await startWithAgent(page);

  await test.step("Mermaid draws the page's diagrams on load", async () => {
    const result = await showUntilReported(conversationId, "Backup", diagramsDrawnOnLoad(SOUND_DIAGRAM, PIPE_IN_LABEL));
    expect(result).toContain("but the page reported errors:");
    expect(reportedErrors(result)).toEqual([expect.stringMatching(PIPE_ERROR)]);
    await expect(pageErrors(page)).toHaveText([/^Mermaid: Parse error on line 2:[\s\S]*got 'PIPE'/]);
  });

  await test.step("a slow page is drawn whole before it reports", async () => {
    const result = await showUntilReported(conversationId, "Slow backup", diagramsDrawnSlowly(SOUND_DIAGRAM, PIPE_IN_LABEL));
    expect(reportedErrors(result)).toEqual([expect.stringMatching(PIPE_ERROR)]);
  });

  await test.step("a page whose script tells of the error itself", async () => {
    const html = `<div id="diagram"></div>${mermaidLibrary()}
<script>mermaid.initialize({ startOnLoad: false }); mermaid.render("backup", ${JSON.stringify(PIPE_IN_LABEL)}).catch((error) => console.error("No diagram:", error));</script>`;
    const result = await showUntilReported(conversationId, "Rendered backup", html);
    expect(reportedErrors(result)).toEqual([expect.stringMatching(PIPE_ERROR)]);
  });

  await test.step("diagrams without errors", async () => {
    const result = await showUntilReported(conversationId, "Sound backup", diagramsDrawnOnLoad(SOUND_DIAGRAM, SOUND_DIAGRAM));
    expect(result).toContain("it rendered without script errors.");
    await expect(pageErrors(page)).toHaveCount(0);
  });
});

const askHeading = (page: Page) => page.locator(".ask:visible h3");
const brokenOption = () => ({ label: "Diagram", html: diagramsDrawnOnLoad(PIPE_IN_LABEL) });
const throwingPage = `<p>Plan</p><script>draw("plan", [[1, 2]]]);</script>`;

test("an agent waiting for an answer hears at once that its question's pages are broken, and the question it asks again takes that one's place", async ({ page }) => {
  await signIn(page, host);
  const conversationId = await startWithAgent(page);

  await test.step("the tool call returns with each page's errors, and the question stays open", async () => {
    const result = await callCanvasTool(host, conversationId, "ask", { question: "Which backup?", html: throwingPage, options: [brokenOption(), { label: "Text" }] });
    expect(result).toContain("but its pages reported errors:");
    expect(result).toContain("Fix them and ask again: the new question takes this one's place.");
    expect(reportedErrors(result).toSorted()).toEqual([
      expect.stringMatching(/^- option "Diagram": Mermaid: Parse error on line 2:/),
      expect.stringMatching(/^- the page above the options: Uncaught SyntaxError: /),
    ]);
    await expect(askHeading(page)).toHaveText("Which backup?");
    await expect(page.locator(".ask:visible").getByRole("radio", { name: "Text" })).toBeEnabled();
  });

  await test.step("asked again with its pages fixed, it waits for the answer as ever", async () => {
    const answered = callCanvasTool(host, conversationId, "ask", {
      question: "Which backup, with its diagram?",
      options: [{ label: "Diagram", html: diagramsDrawnOnLoad(SOUND_DIAGRAM) }, { label: "Text" }],
    });
    await expect(askHeading(page)).toHaveText("Which backup, with its diagram?");
    await expect(page.locator(".ask:visible .ask-option iframe").contentFrame().locator("pre.mermaid svg")).toBeVisible({ timeout: 30_000 });
    await answerCanvasQuestion(page, "Diagram");
    expect(await answered).toBe("The user chose: Diagram");
  });

  await test.step("the broken question is withdrawn, and its errors are told no more", async () => {
    await openFromCanvasHistory(page, "Which backup?");
    await expect(page.locator(".ask:visible")).toContainText("This question was withdrawn.");
    await sendAndWait(page, "Carry on after the question");
    expect(agentSaw()).toContain("Carry on after the question");
    expect(agentSaw()).not.toContain("Which backup?");
  });
});

test("an agent whose answers come as the next message hears of broken pages in the tool's result, or with the answer when the question was first seen later", async ({ page }) => {
  await signIn(page, host);
  const conversationId = await startWithAgent(page);
  await (await conversationSettings(page)).getByLabel("Questions").selectOption("next-message");
  await page.keyboard.press("Escape");
  const brokenAsk = (question: string) => ({ question, options: [brokenOption(), { label: "Text" }] });

  await test.step("someone is viewing the question", async () => {
    let result = "";
    await expect
      .poll(async () => (result = await callCanvasTool(host, conversationId, "ask", brokenAsk("Seen at once?"))), { timeout: 90_000 })
      .toContain("but its pages reported errors:");
    expect(reportedErrors(result)).toEqual([expect.stringMatching(/^- option "Diagram": Mermaid: Parse error on line 2:/)]);
  });

  await test.step("nobody is", async () => {
    await startConversationWithoutModel(page);
    let result = "";
    await expect.poll(async () => (result = await callCanvasTool(host, conversationId, "ask", brokenAsk("Seen later?")))).not.toContain("reported errors");
    expect(result).toContain("Their answer will arrive as their next message.");

    await waitForPageToRender(page, () => selectInSidebar(page, conversationId));
    await expect(askHeading(page)).toHaveText("Seen later?");
    await answerCanvasQuestion(page, "Text");
    await expect(status(page)).toHaveText("idle", { timeout: 60_000 });
    await expect.poll(agentSaw).toMatch(
      /The pages of your question "Seen later\?" \(canvas item [\w-]+\) reported errors:\n- option "Diagram": Mermaid: Parse error on line 2:[\s\S]*My answer to your question "Seen later\?": Text/,
    );
  });
});
