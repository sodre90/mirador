import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, reloadFromRestartedHost, signIn, startConversation } from "./helpers.ts";
import { ScriptedModel, opencodeProgram, scriptedOpencodeEnvironment } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost({ fakePrograms: true });
const model = new ScriptedModel();
const signedInAccount = join(host.root, "signed-in-account");
const refuseSignIn = join(host.root, "refuse-sign-in");

/** Stands in for opencode's own sign-in, which would open a browser, and is the real opencode for everything else. */
function fakeOpencodeSignIn() {
  const realOpencode = opencodeProgram();
  mkdirSync(host.fakeProgramsDir, { recursive: true });
  if (process.platform === "win32") {
    writeFileSync(join(host.fakeProgramsDir, "opencode.cmd"), windowsSignInScript(realOpencode));
    return;
  }
  const script = `#!/bin/sh
if [ "$1" = auth ] && [ "$2" = login ]; then
  if [ -e '${refuseSignIn}' ]; then echo "sign-in refused"; exit 1; fi
  printf '%s' "$SIGN_IN_ACCOUNT" > '${signedInAccount}'
  exit 0
fi
exec '${realOpencode}' "$@"
`;
  writeFileSync(join(host.fakeProgramsDir, "opencode"), script);
  chmodSync(join(host.fakeProgramsDir, "opencode"), 0o755);
}

/** A batch file that runs another batch file without `call` hands over to it for good, as exec does. */
const windowsSignInScript = (realOpencode: string) =>
  [
    "@echo off",
    'if "%~1"=="auth" if "%~2"=="login" goto signIn',
    `"${realOpencode}" %*`,
    "exit /b %errorlevel%",
    ":signIn",
    `if exist "${refuseSignIn}" (echo sign-in refused& exit /b 1)`,
    `<nul set /p "=%SIGN_IN_ACCOUNT%" > "${signedInAccount}"`,
    "exit /b 0",
    "",
  ].join("\r\n");

test.beforeAll(async () => {
  fakeOpencodeSignIn();
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  model.stop();
});

const signInLine = (page: Page) => page.locator(".timeline:visible .sign-in-line");
const notice = (page: Page, text: string) => page.locator(".timeline:visible .notice-line", { hasText: text });

/** What the host records when the agent refuses a prompt until the user signs in again. */
function agentRefusedForSignIn(conversationId: string) {
  const refusal = { type: "error", message: "Authentication required", authRequired: true };
  execFileSync("bun", [join(import.meta.dirname, "seed-events.ts"), join(host.dataDir, "state.sqlite"), conversationId, JSON.stringify([refusal])]);
}

test("Log in runs the agent's sign-in with the conversation's profile in a terminal tab, and says whether it worked", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, "account two", `${scriptedOpencodeEnvironment(model, host.root)}\nSIGN_IN_ACCOUNT=second`, "", "opencode");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "account two · opencode" });
  const conversationId = await startConversation(page);
  await host.stop();
  agentRefusedForSignIn(conversationId);
  await host.start();
  await reloadFromRestartedHost(page);

  const logIn = signInLine(page).getByRole("button", { name: "Log in" });
  const signInTab = page.locator(".terminal-tab", { hasText: "opencode sign-in" });
  const terminalScreen = page.locator(".terminal-pane .terminal-splits.shown .xterm-rows");
  await expect(signInLine(page)).toContainText("Authentication required");

  await test.step("a refused sign-in keeps its tab open to show why, until Enter", async () => {
    writeFileSync(refuseSignIn, "");
    await logIn.click();
    await expect(signInTab).toBeVisible();
    await expect(terminalScreen).toContainText("sign-in refused");
    await expect(terminalScreen).toContainText("Press Enter to close this tab.");
    await page.locator(".terminal-pane .terminal-splits.shown .xterm").click();
    await page.keyboard.press("Enter");
    await expect(signInTab).toHaveCount(0);
    await expect(notice(page, "Signing in did not finish.")).toBeVisible();
    await expect(logIn).toBeVisible();
  });

  await test.step("a sign-in that works signs in the profile's account, closes its tab and retires the Log in button", async () => {
    rmSync(refuseSignIn);
    await logIn.click();
    await expect(notice(page, "Signed in. Send your message again.")).toBeVisible();
    await expect(logIn).toHaveCount(0);
    await expect(signInTab).toHaveCount(0);
    expect(readFileSync(signedInAccount, "utf8")).toBe("second");
  });

  await test.step("/login in the message box, offered among the slash commands, signs in the same way without sending a message", async () => {
    rmSync(signedInAccount);
    const composer = page.locator(".composer:visible textarea");
    await composer.fill("/log");
    await expect(page.getByRole("listbox", { name: "Slash commands" }).locator('[aria-selected="true"] .slash-command-name')).toHaveText("/login");
    await composer.press("Enter");
    await expect(notice(page, "Signed in. Send your message again.")).toHaveCount(2);
    await expect(composer).toHaveValue("");
    expect(readFileSync(signedInAccount, "utf8")).toBe("second");
    await expect(page.locator(".timeline:visible .message.user")).toHaveCount(0);
  });
});
