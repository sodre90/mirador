import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, openSettings, signIn } from "./helpers.ts";
import { pathOf, programOnPath, programOnRegistryPath, scratchPath, TestHost } from "./test-host.ts";

const scratch = scratchPath("claude-not-installed");
const homeWithoutClaude = join(scratch, "home");
const programs = join(scratch, "programs");
const bunDir = dirname(programOnPath("bun"));
const onWindows = process.platform === "win32";
const systemFolders = onWindows ? [join(process.env.SystemRoot ?? "C:\\Windows", "System32")] : ["/usr/bin", "/bin"];
/** Windows keeps the home folder, where the host also looks for claude, in USERPROFILE. */
const host = new TestHost({
  environment: { HOME: homeWithoutClaude, ...(onWindows && { USERPROFILE: homeWithoutClaude }), ...pathOf([programs, bunDir, ...systemFolders]) },
});
const installCommand = onWindows ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash";
const installedLater = join(programs, onWindows ? "claude.cmd" : "claude");

/** Windows runs no script without an extension, so there the claude installed later is a .cmd. */
function installClaudeLater() {
  if (onWindows) return writeFileSync(installedLater, "@echo 9.9.9 (Claude Code)\r\n");
  writeFileSync(installedLater, '#!/bin/sh\necho "9.9.9 (Claude Code)"\n');
  chmodSync(installedLater, 0o755);
}

test.beforeAll(async () => {
  mkdirSync(homeWithoutClaude, { recursive: true });
  mkdirSync(programs, { recursive: true });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  rmSync(scratch, { recursive: true, force: true });
});

test("Settings says how to install Claude Code, and finds it once it is installed", async ({ page }) => {
  test.skip(onWindows && programOnRegistryPath("claude") !== "", "This Windows machine has a claude on the PATH its registry holds, where the host looks too");
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);

  await test.step("with no claude anywhere, it gives this computer's install command", async () => {
    const settings = await openSettings(page, "Agents");
    await expect(settings.locator(".claude-program-found")).toHaveText(
      `Claude Code is not installed. Install it with ${installCommand}, or enter where its claude program is.`,
    );
  });

  await test.step("installed while the host runs, it is found when the page opens again", async () => {
    installClaudeLater();
    await page.reload();
    const settings = await openSettings(page, "Agents");
    await expect(settings.locator(".claude-program-found")).toHaveText(`Runs ${installedLater}, 9.9.9 (Claude Code)`);
  });
});
