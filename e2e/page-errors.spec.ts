import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost({ copiesSource: true });

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

function editSource(file: string, from: string, to: string) {
  const path = join(host.sourceDir, file);
  const source = readFileSync(path, "utf8");
  expect(source.split(from)).toHaveLength(2);
  writeFileSync(path, source.split(from).join(to));
}

test("an error the page throws goes to the host log", async ({ page }) => {
  await signIn(page, host);
  await page.evaluate(() => setTimeout(() => Promise.reject(new Error("e2e rejection nobody handled"))));
  await expect.poll(() => host.log).toContain("page error: Error: e2e rejection nobody handled");
});

test("an error while rendering shows a way to reload instead of a blank page, and its stack goes to the host log", async ({ page }) => {
  await signIn(page, host);
  editSource("web/i18n/en/shell.ts", `noConversation: "No conversation selected"`, `get noConversation(): string { throw new Error("e2e render error"); }`);
  const brokePage = page.getByRole("alert");
  await expect(async () => {
    await page.reload();
    await expect(brokePage.getByRole("heading", { name: "Something went wrong on this page" })).toBeVisible({ timeout: 2_000 });
  }, "the watcher hears about the edit a moment after it is written").toPass({ timeout: 20_000 });
  await expect.poll(() => host.log).toContain("page error: Error: e2e render error");
  expect(host.log).toMatch(/page error: Error: e2e render error\n[\s\S]*\n.*component stack:\n/);

  editSource("web/i18n/en/shell.ts", `get noConversation(): string { throw new Error("e2e render error"); }`, `noConversation: "No conversation selected"`);
  await expect(async () => {
    await brokePage.getByRole("button", { name: "Reload" }).click({ timeout: 2_000 });
    await expect(page.getByRole("heading", { name: "No conversation selected" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
});
