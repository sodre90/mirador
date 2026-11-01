import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fakeMicrophone } from "./fake-microphone.ts";
import { addWorkspace, createProfile, openSettings, sendMessage, signIn, useOwnVoiceServer, voiceSection, waitForTurnToEnd } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";
import { toneWav } from "./wav.ts";

test.use(fakeMicrophone);

const REPLY = "All twelve tests in `e2e/` passed.";
const SUMMARY = ["The agent ran the end to end tests.", "All of them passed."];

const summed: string[] = [];
const spoken: { input: string; voice: string; format: string }[] = [];
let speechFails = false;

/** Speech recognition, a voice model and a reply voice, as OpenAI-style servers of the user's own would answer. */
const voiceServer = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString();
    if (request.url!.endsWith("/audio/transcriptions")) {
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify({ text: `SAY ${REPLY}`, language: "en" }));
    }
    if (request.url!.endsWith("/chat/completions")) {
      const { messages } = JSON.parse(body) as { messages: { content: string }[] };
      summed.push(messages[1]!.content);
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: SUMMARY.join("\n") }, finish_reason: "stop" }] }));
    }
    const { input, voice, response_format } = JSON.parse(body) as { input: string; voice: string; response_format: string };
    spoken.push({ input, voice, format: response_format });
    if (speechFails) {
      response.statusCode = 500;
      return response.end("voice not loaded");
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
  await host.stop();
  await host.cleanUp();
  voiceServer.close();
});

const voiceAddress = () => `http://127.0.0.1:${(voiceServer.address() as AddressInfo).port}/v1`;

test("a reply to a dictated message is summed up and read aloud as the turn ends, and every reply has a button reading it", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const profiles = await createProfile(page, "voice", "", "", "opencode");
  await profiles.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "voice · opencode" });
  await page.getByRole("button", { name: "+ New conversation" }).click();

  const settings = await openSettings(page, "Voice");
  const speaking = voiceSection(settings, "When you speak");
  await useOwnVoiceServer(speaking, "Speech recognition", { url: voiceAddress(), model: "whisper-turbo" });
  await useOwnVoiceServer(voiceSection(settings, "Translating and summing up"), "Voice model", { url: voiceAddress(), model: "gemma" });
  const replies = voiceSection(settings, "When the agent replies");
  await useOwnVoiceServer(replies, "Read aloud", { url: voiceAddress(), model: "tts-1", voice: "alloy" });
  await expect(replies.getByLabel("Language")).toHaveValue("en");
  await speaking.getByLabel("Send right away").check();
  await expect(speaking.getByRole("status")).toHaveText("Saved.");
  await settings.getByRole("button", { name: "Close" }).click();

  const reply = page.locator(".timeline:visible .timeline-entry").filter({ has: page.locator(".message.agent") }).last();
  const readAloud = reply.getByRole("button", { name: "Read aloud" });
  const stopReading = reply.getByRole("button", { name: "Stop reading" });

  await test.step("the turn a dictated message started ends with its reply summed up and spoken, a sentence at a time", async () => {
    await page.locator(".composer:visible").getByRole("button", { name: "Dictate" }).click();
    await expect(reply.locator(".message.agent")).toHaveText(REPLY.replace(/`/g, ""), { timeout: 30_000 });
    await expect(stopReading).toBeVisible();
    await expect(readAloud).toBeVisible({ timeout: 15_000 });
    expect(summed).toEqual([`<reply>${REPLY}</reply>`]);
    expect(spoken).toEqual(SUMMARY.map((input) => ({ input, voice: "alloy", format: "wav" })));
  });

  await test.step("a typed message's reply stays quiet, and its button reads it", async () => {
    await sendMessage(page, "SAY Done.");
    await waitForTurnToEnd(page);
    await expect(reply.locator(".message.agent")).toHaveText("Done.");
    await page.waitForTimeout(1_000);
    expect(summed).toHaveLength(1);
    await readAloud.click();
    await expect(stopReading).toBeVisible();
    await expect(readAloud).toBeVisible({ timeout: 15_000 });
    expect(summed.at(-1)).toBe("<reply>Done.</reply>");
    expect(spoken).toHaveLength(4);
  });

  await test.step("the button shows when the pointer is over its reply", async () => {
    await page.locator(".composer:visible textarea").hover();
    await expect(readAloud).toHaveCSS("opacity", "0");
    await reply.hover();
    await expect(readAloud).toHaveCSS("opacity", "1");
  });

  await test.step("hearing a reply again replays its summary and sound, without asking the servers again", async () => {
    await readAloud.click();
    await expect(stopReading).toBeVisible();
    await expect(readAloud).toBeVisible({ timeout: 15_000 });
    expect(summed).toHaveLength(2);
    expect(spoken).toHaveLength(4);
  });

  await test.step("stopping it, or starting the microphone, ends the reading", async () => {
    await readAloud.click();
    await expect(stopReading).toBeVisible();
    await stopReading.click();
    await expect(readAloud).toBeVisible();
    await readAloud.click();
    await expect(stopReading).toBeVisible();
    const dictate = page.locator(".composer:visible").getByRole("button", { name: "Dictate" });
    await dictate.click();
    await expect(readAloud).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dictate).toHaveAttribute("aria-pressed", "false");
  });

  await test.step("a reply voice that fails says why under the reply", async () => {
    await sendMessage(page, "SAY Not heard yet.");
    await waitForTurnToEnd(page);
    speechFails = true;
    await readAloud.click();
    await expect(reply.getByRole("alert")).toHaveText("The reply voice server answered 500: voice not loaded");
    await expect(readAloud).toBeVisible();
    speechFails = false;
  });

  await test.step("another reply voice saved makes a summary and sound of its own", async () => {
    const voice = await openSettings(page, "Voice");
    const replies = voiceSection(voice, "When the agent replies");
    await replies.getByLabel("Voice", { exact: true }).fill("nova");
    await replies.getByRole("button", { name: "Save" }).click();
    await expect(replies.getByRole("status")).toHaveText("Saved.");
    await voice.getByRole("button", { name: "Close" }).click();
    const summedBefore = summed.length;
    await reply.hover();
    await readAloud.click();
    await expect(stopReading).toBeVisible();
    await expect(readAloud).toBeVisible({ timeout: 15_000 });
    expect(summed.length).toBe(summedBefore + 1);
    expect(spoken.slice(-2).map(({ voice }) => voice)).toEqual(["nova", "nova"]);
  });

  await test.step("without a voice model to sum them up, replies have no button, and Settings says what they need", async () => {
    const voice = await openSettings(page, "Voice");
    const voiceModel = voiceSection(voice, "Translating and summing up");
    await voiceModel.getByLabel("Voice model").selectOption({ label: "Off" });
    await expect(voiceModel.getByRole("status")).toHaveText("Saved.");
    await expect(voiceSection(voice, "When the agent replies")).toContainText("Spoken replies need a voice model, which sums each reply up. Set one above.");
    await voice.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(".timeline:visible .read-aloud")).toHaveCount(0);
  });
});
