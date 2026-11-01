import { hostname } from "node:os";
import { expect, test } from "@playwright/test";
import { openSettings, signIn } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();

test.beforeAll(() => host.start());
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
});

test("Settings name the machine for every page, and an emptied name goes back to the computer's", async ({ page, browser }) => {
  await signIn(page, host);
  const other = await (await browser.newContext()).newPage();
  await signIn(other, host);
  const otherName = (await openSettings(other, "Devices")).getByLabel("Name", { exact: true });
  const name = (await openSettings(page, "Devices")).getByLabel("Name", { exact: true });
  await expect(name).toHaveAttribute("placeholder", hostname().replace(/\.local$/, ""));
  await expect(name).toHaveValue("");
  await name.fill("  Studio Mac ");
  await name.press("Enter");
  await expect(otherName).toHaveValue("Studio Mac");
  await page.reload();
  const reopened = (await openSettings(page, "Devices")).getByLabel("Name", { exact: true });
  await expect(reopened).toHaveValue("Studio Mac");
  await reopened.fill("");
  await reopened.blur();
  await expect(otherName).toHaveValue("");
  await other.context().close();
});
