import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { addWorkspace, callCanvasTool, createProfile, openSettings, sendMessage, signIn, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram, writeCompiledBunProgram } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const appFile = join(host.projectDir, "src", "app.ts");
const outsideFile = join(host.root, "elsewhere", "notes.md");
const openedLog = join(host.root, "opened.log");
const SCRIPT_EDITOR = "script-editor";

const openedSoFar = () => (existsSync(openedLog) ? readFileSync(openedLog, "utf8") : "");

/**
 * Each stand-in notes its own name and what it was given, so a spec tells the text editor from the default program.
 * The system's opener fails for an .unclaimed file, as macOS's open does for a type no app claims.
 */
function fakeAgentAndOpeners() {
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
  for (const opener of ["open", "xdg-open", ...(process.platform === "win32" ? [] : [SCRIPT_EDITOR])]) {
    const failsForUnclaimed = opener === SCRIPT_EDITOR ? "" : `case "$*" in *.unclaimed) exit 1 ;; esac\n`;
    writeFileSync(join(host.fakeProgramsDir, opener), `#!/bin/sh\necho "${opener} $*" >> '${openedLog}'\n${failsForUnclaimed}`);
    chmodSync(join(host.fakeProgramsDir, opener), 0o755);
  }
  // Windows opens a file by running Invoke-Item on powershell.exe, so a stand-in powershell notes the opening there.
  if (process.platform === "win32") writeCompiledBunProgram(host.fakeProgramsDir, "powershell", join(import.meta.dirname, "fake-powershell-opener.ts"), { MIRADOR_OPENED_LOG: openedLog });
  // Windows opens a script in Notepad, and runs no .cmd as the program Settings name, so both of those stand-ins are compiled.
  if (process.platform === "win32") {
    for (const editor of ["notepad", SCRIPT_EDITOR]) {
      writeCompiledBunProgram(host.fakeProgramsDir, editor, join(import.meta.dirname, "fake-text-editor.ts"), { MIRADOR_OPENED_LOG: openedLog, MIRADOR_EDITOR_NAME: editor });
    }
  }
}

const systemTextEditorOpening = (file: string) => ({ darwin: `open -t ${file}`, win32: `notepad ${file}` })[process.platform as string] ?? `xdg-open ${file}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  mkdirSync(join(host.projectDir, "src"), { recursive: true });
  mkdirSync(join(host.root, "elsewhere"), { recursive: true });
  fakeAgentAndOpeners();
  cpSync(join(import.meta.dirname, "..", "tests", "fixtures", "canvas-plugins", "board"), join(host.dataDir, "plugins", "board"), { recursive: true });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

const toolCardFor = (page: import("@playwright/test").Page, path: string) =>
  page.locator("details.tool").filter({ has: page.locator(".locations button", { hasText: path }) });

test("a file the agent wrote is a link in its tool card, and clicking it opens the file with the system's default program", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "open-files", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "open-files · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  await sendMessage(page, `WRITE ${JSON.stringify([{ edit: appFile, content: "export {};\n" }, { edit: outsideFile, content: "notes\n" }])}`);
  await waitForTurnToEnd(page);

  for (const path of [appFile, outsideFile]) {
    await test.step(`clicking the link for ${path} opens it`, async () => {
      const card = toolCardFor(page, path);
      await card.locator("summary").click();
      await card.locator(".locations button", { hasText: path }).click();
      await expect.poll(() => (existsSync(openedLog) ? readFileSync(openedLog, "utf8") : "")).toContain(realpathSync.native(path));
    });
  }
});

test("a file path the agent writes in backticks in its reply is a link that opens the file", async ({ page }) => {
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "open-files · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  await sendMessage(page, `SAY Look at \`${appFile}\` and \`src/app.ts\`, then \`not a file\`.`);
  await waitForTurnToEnd(page);

  for (const path of [appFile, "src/app.ts"]) {
    await test.step(`the path ${path} opens`, async () => {
      const before = existsSync(openedLog) ? readFileSync(openedLog, "utf8") : "";
      await page.locator(".message.agent .markdown").getByRole("button", { name: path, exact: true }).click();
      // The host opens the file at its real path: absolute, every link followed, with this system's separators.
      await expect.poll(() => (existsSync(openedLog) ? readFileSync(openedLog, "utf8") : "").slice(before.length)).toContain(realpathSync.native(resolve(host.projectDir, path)));
    });
  }
  await expect(page.locator(".message.agent .markdown button.file-link", { hasText: "not a file" })).toHaveCount(0);

  await test.step("a path that opens looks unlike the code around it that does not", async () => {
    const looksOf = (code: Locator) => code.evaluate((element) => ({ color: getComputedStyle(element).color, underline: getComputedStyle(element).textDecorationStyle }));
    const linkCode = page.locator(".message.agent .markdown button.file-link code").getByText("src/app.ts", { exact: true });
    await page.mouse.move(0, 0);
    const link = await looksOf(linkCode);
    const plain = await looksOf(page.locator(".message.agent .markdown code", { hasText: "not a file" }));
    expect(link.color).not.toBe(plain.color);
    expect(link.underline).toBe("dotted");
    await linkCode.hover();
    await expect.poll(async () => (await looksOf(linkCode)).underline).toBe("solid");
  });
});

test("code in a table cell beside a long one stays on one line", async ({ page }) => {
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "open-files · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  const longCell = "The router, which routes every request by its model id and pipes streams through unbuffered. ".repeat(4);
  await sendMessage(page, `SAY | file | what |\n| --- | --- |\n| \`proxy.mjs\` | ${longCell} |\n| \`src/app.ts\` | short |`);
  await waitForTurnToEnd(page);

  for (const name of ["src/app.ts", "proxy.mjs"]) {
    const code = page.locator(".message.agent .markdown td code").getByText(name, { exact: true });
    await expect(code).toBeVisible();
    const linesOfText = await code.evaluate((element) => {
      const text = document.createRange();
      text.selectNodeContents(element);
      return text.getClientRects().length;
    });
    expect(linesOfText, name).toBe(1);
  }
});

test("a plugin's view opens a file through Mirador, as a file link in the chat does", async ({ page }) => {
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "open-files · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await expect(page).toHaveURL(/#\/c\/.+$/);
  const conversationId = page.url().match(/#\/c\/(.+)$/)![1]!;
  await callCanvasTool(host, conversationId, "show_card", { title: "Files", text: "Open one" });

  const before = openedSoFar();
  await page.frameLocator(".canvas-panel:visible .canvas-frame.plugin iframe").getByRole("button", { name: "Open src/app.ts" }).click();
  await expect.poll(() => openedSoFar().slice(before.length)).toContain(realpathSync.native(appFile));
});

test("a link to a file outside the workspace that the agent did not change asks first, naming the file, and opens it only once agreed", async ({ page }) => {
  const writtenFromShell = join(host.root, "elsewhere", "description.md");
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "open-files · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  await sendMessage(page, `WRITE ${JSON.stringify([{ shell: writtenFromShell, content: "draft\n" }, { read: writtenFromShell }])}`);
  await waitForTurnToEnd(page);
  await sendMessage(page, `SAY The description is in \`${writtenFromShell}\`, and \`missing/notes.md\` is not.`);
  await waitForTurnToEnd(page);
  const prompt = page.getByRole("alertdialog", { name: "Open a file outside this workspace?" });
  const openedBefore = openedSoFar();

  await test.step("the reply's link asks, naming the file, and Cancel or Esc opens nothing", async () => {
    await page.locator(".message.agent .markdown").getByRole("button", { name: writtenFromShell, exact: true }).click();
    await expect(prompt).toContainText(`${realpathSync.native(writtenFromShell)} is outside this workspace, and the agent did not change it in this conversation.`);
    await expect(prompt.getByRole("button", { name: "Cancel" })).toBeFocused();
    await prompt.getByRole("button", { name: "Cancel" }).click();
    await expect(prompt).toBeHidden();
    await page.locator(".message.agent .markdown").getByRole("button", { name: writtenFromShell, exact: true }).click();
    await expect(prompt).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(prompt).toBeHidden();
    expect(openedSoFar()).toBe(openedBefore);
  });

  await test.step("the tool card's link asks too, and Open opens the file", async () => {
    const card = toolCardFor(page, writtenFromShell);
    await card.locator("summary").click();
    await card.locator(".locations button", { hasText: writtenFromShell }).click();
    await prompt.getByRole("button", { name: "Open" }).click();
    await expect(prompt).toBeHidden();
    await expect.poll(() => openedSoFar().slice(openedBefore.length)).toContain(realpathSync.native(writtenFromShell));
  });

  await test.step("a path that is not in the workspace says which folder it looked in", async () => {
    await page.locator(".message.agent .markdown").getByRole("button", { name: "missing/notes.md", exact: true }).click();
    await expect(page.locator(".notices .notice", { hasText: `missing/notes.md does not exist in ${host.projectDir}.` })).toBeVisible();
    await expect(prompt).toBeHidden();
  });
});

test("a link to a program says Mirador does not run it, and opens nothing", async ({ page }) => {
  const program = join(host.projectDir, "tools", "run.jar");
  mkdirSync(join(host.projectDir, "tools"), { recursive: true });
  writeFileSync(program, "");
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "open-files · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  await sendMessage(page, "SAY Run `tools/run.jar` to build it.");
  await waitForTurnToEnd(page);

  const openedBefore = existsSync(openedLog) ? readFileSync(openedLog, "utf8") : "";
  await page.locator(".message.agent .markdown").getByRole("button", { name: "tools/run.jar", exact: true }).click();
  await expect(page.locator(".notices .notice", { hasText: "tools/run.jar would run as a program, so Mirador does not open it." })).toBeVisible();
  expect(existsSync(openedLog) ? readFileSync(openedLog, "utf8") : "").toBe(openedBefore);
});

test("a link named like a document that leads to a program says Mirador does not run it, and opens nothing", async ({ page }) => {
  mkdirSync(join(host.projectDir, "tools"), { recursive: true });
  mkdirSync(join(host.projectDir, "docs"), { recursive: true });
  writeFileSync(join(host.projectDir, "tools", "build.jar"), "");
  symlinkSync(join(host.projectDir, "tools", "build.jar"), join(host.projectDir, "docs", "guide.md"));
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "open-files · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  await sendMessage(page, "SAY Read `docs/guide.md` first.");
  await waitForTurnToEnd(page);

  const openedBefore = existsSync(openedLog) ? readFileSync(openedLog, "utf8") : "";
  await page.locator(".message.agent .markdown").getByRole("button", { name: "docs/guide.md", exact: true }).click();
  await expect(page.locator(".notices .notice", { hasText: "docs/guide.md would run as a program, so Mirador does not open it." })).toBeVisible();
  expect(existsSync(openedLog) ? readFileSync(openedLog, "utf8") : "").toBe(openedBefore);
});

const SCRIPTS = ["scripts/setup.sh", "scripts/build.py"];

test("a link to a script opens it as text in the system's text editor, which would not run it", async ({ page }) => {
  mkdirSync(join(host.projectDir, "scripts"), { recursive: true });
  SCRIPTS.forEach((script) => writeFileSync(join(host.projectDir, script), "echo hi\n"));
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "open-files · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  await sendMessage(page, `SAY Run ${SCRIPTS.map((script) => `\`${script}\``).join(" and ")}.`);
  await waitForTurnToEnd(page);

  for (const script of SCRIPTS) {
    await test.step(`${script} opens as text`, async () => {
      const before = openedSoFar();
      await page.locator(".message.agent .markdown").getByRole("button", { name: script, exact: true }).click();
      await expect.poll(() => openedSoFar().slice(before.length)).toContain(systemTextEditorOpening(realpathSync.native(join(host.projectDir, script))));
    });
  }
});

// The host keeps the program for the specs after this one.
test("Settings can name the program scripts open in, which every window shows and a script link then opens in", async ({ page }) => {
  await signIn(page, host);
  const settings = await openSettings(page, "Conversations");
  const opener = settings.getByLabel("Scripts open in");
  await expect(opener).toHaveValue("text-editor");
  await opener.selectOption({ label: "A program you name" });
  await settings.getByLabel("Program", { exact: true }).fill(SCRIPT_EDITOR);
  await settings.getByLabel("Program", { exact: true }).press("Enter");

  const otherWindow = await page.context().newPage();
  await otherWindow.goto(page.url());
  const otherSettings = await openSettings(otherWindow, "Conversations");
  await expect(otherSettings.getByLabel("Scripts open in")).toHaveValue("program");
  await expect(otherSettings.getByLabel("Program", { exact: true })).toHaveValue(SCRIPT_EDITOR);
  await otherWindow.close();
  await settings.getByRole("button", { name: "Close" }).click();

  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "open-files · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  await sendMessage(page, `SAY Run \`${SCRIPTS[0]}\`.`);
  await waitForTurnToEnd(page);
  const before = openedSoFar();
  await page.locator(".message.agent .markdown").getByRole("button", { name: SCRIPTS[0], exact: true }).click();
  await expect.poll(() => openedSoFar().slice(before.length)).toContain(`${SCRIPT_EDITOR} ${realpathSync.native(join(host.projectDir, SCRIPTS[0]!))}`);
});

test("a link to a file no program is set to open opens it as text in the program scripts open in, or says why not when it is not text", async ({ page }) => {
  const [text, binary] = ["notes/beads.unclaimed", "notes/photo.unclaimed"];
  const textOutside = join(host.root, "elsewhere", "beads-export.unclaimed");
  mkdirSync(join(host.projectDir, "notes"), { recursive: true });
  writeFileSync(join(host.projectDir, text), '{"id":1}\n');
  writeFileSync(textOutside, '{"id":2}\n');
  writeFileSync(join(host.projectDir, binary), new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0x08]));
  await signIn(page, host);
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "open-files · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  await sendMessage(page, `SAY Look at \`${text}\`, \`${textOutside}\` and \`${binary}\`.`);
  await waitForTurnToEnd(page);

  await test.step("the text file opens as text", async () => {
    const before = openedSoFar();
    await page.locator(".message.agent .markdown").getByRole("button", { name: text, exact: true }).click();
    await expect.poll(() => openedSoFar().slice(before.length)).toContain(`${SCRIPT_EDITOR} ${realpathSync.native(join(host.projectDir, text))}`);
  });

  await test.step("a text file outside the workspace opens as text once the owner agrees", async () => {
    const before = openedSoFar();
    await page.locator(".message.agent .markdown").getByRole("button", { name: textOutside, exact: true }).click();
    await page.getByRole("alertdialog", { name: "Open a file outside this workspace?" }).getByRole("button", { name: "Open" }).click();
    await expect.poll(() => openedSoFar().slice(before.length)).toContain(`${SCRIPT_EDITOR} ${realpathSync.native(textOutside)}`);
  });

  await test.step("the other file says no program is set to open it, and does not open as text", async () => {
    const before = openedSoFar();
    await page.locator(".message.agent .markdown").getByRole("button", { name: binary, exact: true }).click();
    await expect(page.locator(".notices .notice", { hasText: `No program is set to open ${binary}, and it is not text, so Mirador cannot open it.` })).toBeVisible();
    expect(openedSoFar().slice(before.length)).not.toContain(SCRIPT_EDITOR);
  });
});
