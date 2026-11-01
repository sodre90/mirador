import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fakeMicrophone } from "./fake-microphone.ts";
import { addWorkspace, createProfile, openSettings, signIn, useOwnVoiceServer, voiceSection } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";
import { toneWav } from "./wav.ts";

test.use(fakeMicrophone);

const DICTATED = "SAY First answer.";
const NOISE = "Thanks for watching!";

let heard = 0;
let hearTheThirdClip = () => {};
const thirdClipHeard = new Promise<void>((resolve) => (hearTheThirdClip = resolve));

/** Speech recognition hears the dictated message, then only what it makes up from noise; the third clip waits for the test. */
const voiceServer = createServer((request, response) => {
  request.resume();
  request.on("end", async () => {
    if (request.url!.endsWith("/audio/transcriptions")) {
      const clip = ++heard;
      if (clip === 3) await thirdClipHeard;
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify({ text: clip === 1 ? DICTATED : NOISE, language: "en" }));
    }
    if (request.url!.endsWith("/chat/completions")) {
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "The agent answered." }, finish_reason: "stop" }] }));
    }
    response.setHeader("content-type", "audio/wav");
    response.end(toneWav(1));
  });
});

const host = new TestHost({ fakePrograms: true });

test.beforeAll(async () => {
  await new Promise<void>((resolve) => voiceServer.listen(0, "127.0.0.1", resolve));
  writeBunProgram(host.fakeProgramsDir, "opencode", join(import.meta.dirname, "fake-acp-agent.ts"), { FAKE_ACP_PROMPTS: join(host.root, "prompts") });
  await host.start();
});
test.afterAll(async () => {
  hearTheThirdClip();
  await host.stop();
  await host.cleanUp();
  voiceServer.close();
});

const voiceAddress = () => `http://127.0.0.1:${(voiceServer.address() as AddressInfo).port}/v1`;

test("with Keep talking, rounds that hear only noise don't start its two minutes over: once they are up, the microphone stays closed", async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "voice", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "voice · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  const settings = await openSettings(page, "Voice");
  await useOwnVoiceServer(voiceSection(settings, "When you speak"), "Speech recognition", { url: voiceAddress(), model: "whisper-turbo" });
  await useOwnVoiceServer(voiceSection(settings, "Translating and summing up"), "Voice model", { url: voiceAddress(), model: "gemma" });
  const replies = voiceSection(settings, "When the agent replies");
  await useOwnVoiceServer(replies, "Read aloud", { url: voiceAddress(), model: "kokoro", voice: "af_heart" });
  await replies.getByLabel("Keep talking").check();
  await expect(replies.getByRole("status")).toHaveText("Saved.");
  await settings.getByRole("button", { name: "Close" }).click();

  const composer = page.locator(".composer:visible");
  const dictate = composer.getByRole("button", { name: "Dictate" });

  await test.step("after the reply has been read, a round that hears only noise listens on", async () => {
    await dictate.click();
    await expect(composer.locator("textarea")).toHaveValue(DICTATED, { timeout: 30_000 });
    await composer.locator("textarea").press("Enter");
    await expect.poll(() => heard, { timeout: 30_000 }).toBe(3);
  });

  await test.step("noise heard once the two minutes since the reply are up ends the conversation", async () => {
    await page.clock.fastForward("02:01");
    hearTheThirdClip();
    await page.waitForTimeout(8_000);
    await expect(dictate).toHaveAttribute("aria-pressed", "false");
    expect(heard, "no round listened after the third").toBe(3);
    await expect(page.locator(".timeline:visible .message.user")).toHaveCount(1);
  });
});
