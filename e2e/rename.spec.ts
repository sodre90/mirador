import { expect, test, type Locator, type Page } from "@playwright/test";
import { FakeGateway, gatewayEnvironment } from "./fake-gateway.ts";
import { addWorkspace, createProfile, sendMessage, signIn, startConversation } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const host = new TestHost();
const gateway = new FakeGateway();

test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await gateway.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  gateway.stop();
});

const headerTitle = (page: Page) => page.locator(".chat-header h2");
const sidebarTitles = (page: Page) => page.locator(".workspace li .conversation-title");
const cursorOver = (title: Locator) => title.evaluate((element) => getComputedStyle(element).cursor);

test("a conversation is renamed from its header, and a name the user chose survives the first message and a reload", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, "fake gateway", gatewayEnvironment(gateway));
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "fake gateway · Claude Code" });
  await startConversation(page);

  expect(await cursorOver(headerTitle(page).getByText("New conversation"))).toBe("text");
  await headerTitle(page).getByText("New conversation").click();
  const field = page.getByLabel("Conversation name");
  await expect(field).toBeFocused();
  await field.fill("Login bug");
  await field.press("Enter");
  await expect(headerTitle(page)).toHaveText("Login bug");
  await expect(sidebarTitles(page)).toHaveText(["Login bug"]);

  await sendMessage(page, "this first message would otherwise become the title");
  await expect(page.locator(".timeline")).toContainText("fake gateway says no", { timeout: 60_000 });
  await page.reload();
  await expect(headerTitle(page)).toHaveText("Login bug");
});

test("a conversation is renamed from the sidebar or the palette, and Esc cancels", async ({ page }) => {
  await signIn(page, host);
  const title = sidebarTitles(page).first();
  expect(await cursorOver(title)).toBe("pointer");
  await title.dblclick();
  const field = page.getByLabel("Conversation name");
  await field.fill("Never saved");
  await field.press("Escape");
  await expect(title).toHaveText("Login bug");

  await title.dblclick();
  await field.fill("Checkout flow");
  await field.press("Enter");
  await expect(title).toHaveText("Checkout flow");
  await expect(headerTitle(page)).toHaveText("Checkout flow");

  await page.keyboard.press("Control+KeyK");
  const palette = page.getByLabel("Search conversations and actions");
  await palette.fill("rename");
  await palette.press("Enter");
  await expect(field).toBeFocused();
  await page.keyboard.type("Payments");
  await page.keyboard.press("Enter");
  await expect(title).toHaveText("Payments");
});
