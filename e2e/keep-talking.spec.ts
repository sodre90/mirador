import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fakeMicrophone } from "./fake-microphone.ts";
import { addWorkspace, createProfile, openSettings, signIn, useOwnVoiceServer, voiceSection } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";
import { toneWav } from "./wav.ts";

test.use(fakeMicrophone);

const SAID = ["SAY First answer.", "SAY Second answer.", "Please repeat that.", "Thanks for watching!", "SAY Third answer.", "Thank you. Thank you.", "SAY Fourth answer."];

let heard = 0;

/** Speech recognition hears the next of what was said each time, the voice model sums a reply up in one sentence, and the reply voice plays a tone. */
const voiceServer = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    if (request.url!.endsWith("/audio/transcriptions")) {
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify({ text: SAID[heard++] ?? "SAY Too many.", language: "en" }));
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
  await host.stop();
  await host.cleanUp();
  voiceServer.close();
});

const voiceAddress = () => `http://127.0.0.1:${(voiceServer.address() as AddressInfo).port}/v1`;

test("with Keep talking, the microphone opens again once a dictated message's reply has been read, and what is said next is sent", async ({ page }) => {
  test.setTimeout(180_000);
  /** Notes which reply each reading is of: a reply heard again plays the sound it kept, without asking the voice server. */
  await page.addInitScript(() => {
    const readings: number[] = [];
    (window as unknown as { readings: number[] }).readings = readings;
    new MutationObserver((changes) => {
      for (const change of changes) {
        const button = change.target as Element;
        if (button.getAttribute("aria-label") === "Stop reading") readings.push([...document.querySelectorAll(".read-aloud button")].indexOf(button));
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["aria-label"] });
  });
  const readings = () => page.evaluate(() => (window as unknown as { readings: number[] }).readings);
  /** The chimes by their first pitch: rising from 660 Hz as the microphone opens, falling from 880 Hz once it has heard. */
  await page.addInitScript(() => {
    const chimes: string[] = [];
    (window as unknown as { chimes: string[] }).chimes = chimes;
    const firstPitch = new WeakMap<AudioParam, number>();
    const setValueAtTime = AudioParam.prototype.setValueAtTime;
    AudioParam.prototype.setValueAtTime = function (value, at) {
      if (!firstPitch.has(this)) firstPitch.set(this, value);
      return setValueAtTime.call(this, value, at);
    };
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (at) {
      const pitch = firstPitch.get(this.frequency);
      if (pitch === 660) chimes.push("listening");
      if (pitch === 880) chimes.push("heard");
      return start.call(this, at);
    };
  });
  const chimes = () => page.evaluate(() => (window as unknown as { chimes: string[] }).chimes);
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
  await expect(replies.getByLabel("Keep talking"), "only spoken replies can keep a conversation going").toHaveCount(0);
  await useOwnVoiceServer(replies, "Read aloud", { url: voiceAddress(), model: "kokoro", voice: "af_heart" });
  await replies.getByLabel("Keep talking").check();
  await expect(replies.getByRole("status")).toHaveText("Saved.");
  await settings.getByRole("button", { name: "Close" }).click();

  const asked = page.locator(".timeline:visible .message.user");
  const answers = page.locator(".timeline:visible .message.agent");
  const composer = page.locator(".composer:visible");
  const dictate = composer.getByRole("button", { name: "Dictate" });

  await test.step("the first dictated message is checked and sent by hand, as Send right away is off", async () => {
    await dictate.click();
    await expect(composer.locator("textarea")).toHaveValue(SAID[0]!, { timeout: 30_000 });
    await composer.locator("textarea").press("Enter");
    await expect(answers.last()).toHaveText("First answer.", { timeout: 30_000 });
  });

  await test.step("once its reply has been read, the microphone listens again and sends what it hears, turn after turn", async () => {
    await expect(asked).toHaveText(SAID.slice(0, 2), { timeout: 30_000 });
    await expect(answers.last()).toHaveText("Second answer.", { timeout: 30_000 });
    await expect(dictate, "and listens once more after the second reply").toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
  });

  await test.step("\"repeat that\" reads the last reply again instead of going to the agent, \"Thanks for watching!\" made up from noise is not sent, and the conversation goes on", async () => {
    await expect(asked).toHaveText([SAID[0], SAID[1], SAID[4]], { timeout: 30_000 });
    await expect(answers.last()).toHaveText("Third answer.", { timeout: 30_000 });
  });

  await test.step("a lone \"thank you\" ends the conversation without sending anything", async () => {
    await expect.poll(() => heard, { timeout: 30_000 }).toBe(6);
    await expect(dictate).toHaveAttribute("aria-pressed", "false", { timeout: 30_000 });
    await page.waitForTimeout(6_000);
    await expect(asked).toHaveCount(3);
    await expect(composer.locator("textarea")).toHaveValue("");
    expect(await readings(), "the first, second and third replies, and the second once more").toEqual([0, 1, 1, 2]);
    await expect(dictate).toHaveAttribute("aria-pressed", "false");
  });

  await test.step("Esc ends a conversation started again: nothing more is sent", async () => {
    await dictate.click();
    await expect(composer.locator("textarea")).toHaveValue(SAID[6]!, { timeout: 30_000 });
    await composer.locator("textarea").press("Enter");
    await expect(dictate, "listens again after the reply").toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await page.keyboard.press("Escape");
    await expect(dictate).toHaveAttribute("aria-pressed", "false");
    await page.waitForTimeout(6_000);
    await expect(asked).toHaveCount(4);
    await expect(dictate).toHaveAttribute("aria-pressed", "false");
  });

  await test.step("a chime tells each time the microphone opens again, and each time it has heard, dictating by hand too", async () => {
    const turns = ["listening", "heard"];
    expect(await chimes()).toEqual(["heard", ...turns, ...turns, ...turns, ...turns, ...turns, "heard", "listening"]);
  });
});
