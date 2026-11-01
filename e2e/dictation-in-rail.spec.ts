import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fakeMicrophone } from "./fake-microphone.ts";
import { addWorkspace, openSettings, signIn, startConversation, useOwnVoiceServer, voiceSection, workspaceCard } from "./helpers.ts";
import { TestHost } from "./test-host.ts";

test.use(fakeMicrophone);

const HEARD = "Run the e2e tests.";
let clipsHeard = 0;

/** Answers as an OpenAI-style speech recognition server would, for the machine in the rail. */
const recognitionServer = createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    clipsHeard++;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ text: HEARD, language: "en" }));
  });
});

const server = new TestHost();
const laptop = new TestHost();

test.beforeAll(async () => {
  await new Promise<void>((resolve) => recognitionServer.listen(0, "127.0.0.1", resolve));
  await Promise.all([server.start(), laptop.start()]);
});
test.afterAll(async () => {
  await Promise.all([server.stop(), laptop.stop()]);
  await Promise.all([server.cleanUp(), laptop.cleanUp()]);
  recognitionServer.close();
});

test("another machine's Mirador in the rail dictates with this computer's microphone, through that machine's speech recognition", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const serverPage = await browser.newPage();
  await signIn(serverPage, server);
  await addWorkspace(serverPage, server.projectDir);
  await startConversation(serverPage);
  const settings = await openSettings(serverPage, "Voice");
  await useOwnVoiceServer(voiceSection(settings, "When you speak"), "Speech recognition", {
    url: `http://127.0.0.1:${(recognitionServer.address() as AddressInfo).port}/v1`,
    model: "whisper-turbo",
  });
  await settings.getByRole("button", { name: "Close" }).click();
  const invite = await openSettings(serverPage, "Devices");
  await invite.getByRole("button", { name: "Invite a device" }).click();
  const code = (await invite.locator(".invite-code").textContent())!;

  await signIn(page, laptop);
  await page.locator(".sidebar").getByRole("button", { name: "Machines…" }).click();
  const machines = page.getByRole("dialog", { name: "Machines" });
  await machines.getByLabel("Name").fill("Home server");
  await machines.getByLabel("Address or invite link").fill(server.origin);
  await machines.getByRole("button", { name: "Add", exact: true }).click();
  await machines.locator(".machine-list li", { hasText: "Home server" }).getByRole("button", { name: "Open", exact: true }).click();
  const join = page.getByRole("region", { name: "Join Home server" });
  await join.getByLabel("Invite code or link").fill(code);
  await join.getByRole("button", { name: "Join", exact: true }).click();
  const frame = page.frameLocator('iframe[title="Home server"]');
  await workspaceCard(frame, server.projectDir).locator("li").first().click();

  const box = frame.locator(".composer:visible textarea");
  await frame.locator(".composer:visible").getByRole("button", { name: "Dictate" }).click();
  await expect(box).toHaveValue(HEARD, { timeout: 15_000 });
  await expect(frame.locator(".composer-area:visible .composer-problem")).toHaveCount(0);
  expect(clipsHeard).toBe(1);
});
