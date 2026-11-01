import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fakeMicrophone } from "./fake-microphone.ts";
import { addWorkspace, createProfile, openSettings, signIn, useOwnVoiceServer, voiceSection } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";
import { toneWav } from "./wav.ts";

test.use(fakeMicrophone);

const host = new TestHost({ fakePrograms: true });
const firstDone = () => join(host.root, "first-done");
/** Each dictated message holds the agent's turn until its file exists; the one in between is only dictated into the box. */
const said = () => [`WRITE [{"waitFor": ${JSON.stringify(firstDone())}}]`, "Said while the clock waits.", `WRITE [{"waitFor": ${JSON.stringify(join(host.root, "never"))}}]`];

let heard = 0;

const voiceServer = createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    if (request.url!.endsWith("/audio/transcriptions")) {
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify({ text: said()[heard++] ?? "SAY Too many.", language: "en" }));
    }
    if (request.url!.endsWith("/chat/completions")) {
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "The agent answered." }, finish_reason: "stop" }] }));
    }
    response.setHeader("content-type", "audio/wav");
    response.end(toneWav(1));
  });
});

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

test("with Keep talking, a clock ticks while the agent works on what was dictated, and two low tones tell when the host is lost", async ({ page }) => {
  test.setTimeout(180_000);
  /** The sounds by their first pitch: the clock's tick and tock by the ring a click goes through, the chimes and the tones of a lost connection by their tone's. */
  await page.addInitScript(() => {
    const sounds: string[] = [];
    (window as unknown as { sounds: string[] }).sounds = sounds;
    const named: Record<number, string> = { 660: "listening", 880: "heard", 330: "connection lost" };
    const clockBeats: Record<number, string> = { 2600: "tick", 1900: "tock" };
    const firstPitch = new WeakMap<AudioParam, number>();
    const setValueAtTime = AudioParam.prototype.setValueAtTime;
    AudioParam.prototype.setValueAtTime = function (value, at) {
      if (!firstPitch.has(this)) firstPitch.set(this, value);
      return setValueAtTime.call(this, value, at);
    };
    const connect = AudioNode.prototype.connect as (this: AudioNode, destination: AudioNode) => AudioNode;
    AudioNode.prototype.connect = function (this: AudioNode, destination: AudioNode, ...rest: number[]) {
      const beat = this instanceof AudioBufferSourceNode && destination instanceof BiquadFilterNode ? clockBeats[firstPitch.get(destination.frequency) ?? 0] : undefined;
      if (beat) sounds.push(beat);
      return (connect as (...args: unknown[]) => AudioNode).call(this, destination, ...rest);
    } as typeof AudioNode.prototype.connect;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (at) {
      const name = named[firstPitch.get(this.frequency) ?? 0];
      if (name) sounds.push(name);
      return start.call(this, at);
    };
  });
  const sounds = () => page.evaluate(() => (window as unknown as { sounds: string[] }).sounds);
  const ticks = async () => (await sounds()).filter((sound) => sound === "tick").length;

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
  const dictate = async (text: string) => {
    await composer.getByRole("button", { name: "Dictate" }).click();
    await expect(composer.locator("textarea")).toHaveValue(text, { timeout: 30_000 });
    await composer.locator("textarea").press("Enter");
  };

  await test.step("every 15 seconds of the agent's turn, the clock goes tick-tock, tick-tock", async () => {
    await dictate(said()[0]!);
    await expect.poll(sounds, { timeout: 25_000 }).toEqual(["heard", "tick", "tock", "tick", "tock"]);
  });

  await test.step("while the microphone listens, the clock keeps quiet, and it ticks again after", async () => {
    const microphone = composer.getByRole("button", { name: "Dictate" });
    await microphone.hover();
    await page.mouse.down();
    await expect(microphone).toHaveAttribute("aria-pressed", "true");
    const ticksWhenListening = await ticks();
    await page.waitForTimeout(16_000);
    expect(await ticks(), "a beat of the clock fell while it listened").toBe(ticksWhenListening);
    await page.mouse.up();
    await expect(composer.locator("textarea")).toHaveValue(said()[1]!, { timeout: 30_000 });
    await composer.locator("textarea").fill("");
    await expect.poll(ticks, { timeout: 20_000 }).toBe(ticksWhenListening + 2);
  });

  await test.step("it stops once the turn ends", async () => {
    const ticksBeforeTheEnd = await ticks();
    writeFileSync(firstDone(), "");
    await page.waitForTimeout(17_000);
    expect(await ticks()).toBe(ticksBeforeTheEnd);
  });

  await test.step("losing the host while the agent works plays two low tones, and the clock stops", async () => {
    await dictate(said()[2]!);
    await page.waitForTimeout(1_000);
    await host.stop();
    await expect.poll(sounds, { timeout: 15_000 }).toContain("connection lost");
    const ticksWhenLost = await ticks();
    await page.waitForTimeout(16_000);
    expect(await ticks()).toBe(ticksWhenLost);
  });
});
