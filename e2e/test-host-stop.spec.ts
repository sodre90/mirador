import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addWorkspace, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const LATE_WRITER_SECONDS = 2;

/**
 * Starts a writer that outlives the shell's hangup and writes into the test root after `LATE_WRITER_SECONDS`. Windows has
 * no hangup to ignore, so there PowerShell starts it as a program of its own, whose script has no spaces for
 * Start-Process to split it at.
 */
const startLateWriter = (lateWrite: string) =>
  process.platform === "win32"
    ? `$w='started'; echo "late-writer-$w"; Start-Process -NoNewWindow bun -ArgumentList '-e', 'setTimeout(()=>require(\`fs\`).mkdirSync(String.raw\`${lateWrite}\`,{recursive:true}),${LATE_WRITER_SECONDS * 1000})'`
    : `w=started; (trap '' HUP TERM; echo "late-writer-$w"; sleep ${LATE_WRITER_SECONDS}; mkdir -p '${lateWrite}') &`;

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("stop waits for what the host started, so nothing writes into the test root after cleanUp removed it", async ({ page }) => {
  test.skip(!!process.env.MIRADOR_E2E_KEEP, "MIRADOR_E2E_KEEP keeps the test root, which this spec checks cleanUp removes");
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  await startConversation(page);
  await page.getByRole("button", { name: "Show terminal" }).click();
  await page.locator(".terminal-pane .xterm").click();
  const lateWrite = join(host.root, "written-after-the-host-stopped");
  await page.keyboard.type(`${startLateWriter(lateWrite)}\n`);
  await expect(page.locator(".terminal-pane .xterm-rows")).toContainText("late-writer-started");

  await host.stop();
  await host.cleanUp();
  await new Promise((resolve) => setTimeout(resolve, (LATE_WRITER_SECONDS + 1) * 1000));
  expect(existsSync(host.root)).toBe(false);
});
