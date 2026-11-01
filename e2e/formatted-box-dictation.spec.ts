import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { fakeMicrophone } from "./fake-microphone.ts";
import { addWorkspace, createProfile, openSettings, signIn, useOwnVoiceServer, voiceSection } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";

test.use(fakeMicrophone);

const HEARD = "run the tests";

/** Hears every clip as the same words, as an OpenAI-style speech recognition server would answer. */
const voiceServer = createServer(async (request, response) => {
  for await (const _ of request);
  response.setHeader("content-type", "application/json");
  if (request.url?.endsWith("/audio/transcriptions")) return response.end(JSON.stringify({ text: HEARD, language: "en" }));
  response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: HEARD } }] }));
});
const voiceServerUrl = () => `http://127.0.0.1:${(voiceServer.address() as AddressInfo).port}/v1`;

const host = new TestHost({ fakePrograms: true });

test.beforeAll(async () => {
  await new Promise<void>((resolve) => voiceServer.listen(0, "127.0.0.1", resolve));
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"));
  mkdirSync(host.projectDir, { recursive: true });
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  voiceServer.close();
});

test("in the formatted box, what is dictated goes in at the caret, though the mic button took the focus", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mirador-message-box", "formatted"));
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "dictated", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "dictated · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();
  const settings = await openSettings(page, "Voice");
  await useOwnVoiceServer(voiceSection(settings, "When you speak"), "Speech recognition", { url: voiceServerUrl(), model: "whisper-turbo" });
  await settings.getByRole("button", { name: "Close" }).click();

  const box = page.locator(".composer:visible .formatted-box");
  const value = () => box.evaluate((element) => (element as unknown as HTMLTextAreaElement).value);
  await box.click();
  await page.keyboard.type("Please **now**");
  await expect(box.locator(".box-bold")).toHaveText("now");
  for (let step = 0; step < 4; step++) await page.keyboard.press("ArrowLeft");
  await expect.poll(() => box.evaluate((element) => (element as unknown as HTMLTextAreaElement).selectionStart)).toBe("Please".length);

  await page.locator(".composer:visible").getByRole("button", { name: "Dictate" }).click();
  await expect.poll(value, { timeout: 15_000 }).toBe(`Please ${HEARD} **now**`);
  await expect(box.locator(".box-bold")).toHaveText("now");
});
