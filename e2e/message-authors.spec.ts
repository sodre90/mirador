import { expect, test, type Browser, type Page } from "@playwright/test";
import { FakeClaudeApi, fakeClaudeEnvironment } from "./fake-claude-api.ts";
import { addWorkspace, openSettings, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

const api = new FakeClaudeApi();
const host = new TestHost({ environment: () => fakeClaudeEnvironment(api) });

test.beforeAll(async () => {
  api.limited = false;
  await api.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  api.stop();
});

/** What `tailscale serve` adds to each request it passes on to the host. */
const viaTailscale = { "x-forwarded-for": "100.101.5.7", "tailscale-user-login": "someone@github" };

async function invite(page: Page) {
  const settings = await openSettings(page, "Devices");
  await settings.getByRole("button", { name: "Invite a device" }).click();
  const code = (await settings.locator(".invite-code").textContent())!;
  await settings.getByRole("button", { name: "Close" }).click();
  return code;
}

async function joinAsPhone(browser: Browser, code: string) {
  const phone = await browser.newContext({ extraHTTPHeaders: viaTailscale });
  const page = await phone.newPage();
  await page.goto(host.origin);
  await page.getByLabel("Name this device").fill("Phone");
  await page.getByLabel("Invite code").fill(code);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByRole("button", { name: "Settings…" })).toBeVisible();
  return { phone, page };
}

/** The entry that heads the group of the user's message with this text. */
const groupOf = (page: Page, text: string) =>
  page.locator(".timeline:visible .timeline-entry.group-start", { has: page.locator(".message.user", { hasText: text }) });

async function expectWrittenBy(page: Page, text: string, name: string, initials: string) {
  const group = groupOf(page, text);
  await expect(group.locator(".author .person-name")).toHaveText(name);
  await expect(group.locator(".avatar.user")).toHaveText(initials);
  await expect(group.locator(".avatar.user")).toHaveAttribute("data-color", "teal");
  await expect(group.locator(".avatar.user")).toHaveClass(/\bcolored\b/);
}

test("your name and colour from Settings mark the messages you send, after a reload too, and those from your other devices", async ({ page, browser }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);

  await test.step("Settings → Appearance takes your name and colour, the colour chosen straight after typing the name", async () => {
    const settings = await openSettings(page);
    await expect(settings.getByRole("heading", { name: "Your profile" })).toBeVisible();
    const teal = settings.getByRole("radiogroup", { name: "Colour", exact: true }).getByRole("radio", { name: "Teal" });
    await settings.getByLabel("Name", { exact: true }).fill("Ada Lovelace");
    await teal.click();
    await expect(teal).toHaveAttribute("aria-checked", "true");
    await settings.getByRole("button", { name: "Close" }).click();
  });

  await test.step("a message you send shows your name, and your initials on your colour", async () => {
    await sendMessage(page, "Hello from the laptop");
    await waitForTurnToEnd(page);
    await expectWrittenBy(page, "Hello from the laptop", "Ada Lovelace", "AL");
  });

  await test.step("they stay after a reload, as does the name in Settings", async () => {
    await page.reload();
    await expectWrittenBy(page, "Hello from the laptop", "Ada Lovelace", "AL");
    const settings = await openSettings(page);
    await expect(settings.getByLabel("Name", { exact: true })).toHaveValue("Ada Lovelace");
    await settings.getByRole("button", { name: "Close" }).click();
  });

  const { phone, page: phonePage } = await joinAsPhone(browser, await invite(page));

  await test.step("a joined device is yours, so its messages are written by you too", async () => {
    await phonePage.goto(`${host.origin}/#/c/${conversationId}`);
    await expect(phonePage.locator(".chat-header:visible h2")).toBeVisible();
    await sendMessage(phonePage, "Hello from the phone");
    await waitForTurnToEnd(phonePage);
    await expectWrittenBy(phonePage, "Hello from the phone", "Ada Lovelace", "AL");
    await expectWrittenBy(page, "Hello from the phone", "Ada Lovelace", "AL");
  });

  await test.step("without a name, your messages say You again, on every page at once", async () => {
    const settings = await openSettings(page);
    await settings.getByLabel("Name", { exact: true }).fill("");
    await settings.getByLabel("Name", { exact: true }).press("Enter");
    await settings.getByRole("button", { name: "Close" }).click();
    for (const shown of [page, phonePage]) {
      await expect(groupOf(shown, "Hello from the laptop").locator(".author .person-name")).toHaveText("You");
      await expect(groupOf(shown, "Hello from the phone").locator(".author .person-name")).toHaveText("You");
    }
  });

  await phone.close();
});
