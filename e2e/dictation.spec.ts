import { expect, test, type Locator, type Page } from "@playwright/test";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { fakeMicrophone, SILENCE_SECONDS, SPEECH_SECONDS } from "./fake-microphone.ts";
import { addWorkspace, callCanvasTool, openSettings, signIn, startConversation, useOwnVoiceServer, voiceSection } from "./helpers.ts";
import { NOTHING_HEARD_MS } from "../web/pause-watch.ts";
import { TestHost } from "./test-host.ts";

test.use(fakeMicrophone);

const HEARD_IN_HUNGARIAN = "Futtasd le az e2e teszteket.";
const IN_ENGLISH = "Run the e2e tests.";

interface Clip {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  seconds: number;
}

let clips: Clip[] = [];
let failing = false;
let translationLeftEmpty = false;

async function bodyOf(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function clipIn(body: Buffer, contentType: string): Promise<Clip> {
  const form = await new Response(new Uint8Array(body), { headers: { "content-type": contentType } }).formData();
  const wav = Buffer.from(await (form.get("file") as Blob).arrayBuffer());
  const sampleRate = wav.readUInt32LE(24);
  const channels = wav.readUInt16LE(22);
  const bitsPerSample = wav.readUInt16LE(34);
  return { sampleRate, channels, bitsPerSample, seconds: wav.readUInt32LE(40) / (sampleRate * channels * (bitsPerSample / 8)) };
}

/** Answers as an OpenAI-style speech recognition and chat server would, noting each clip it hears. */
const voiceServer = createServer(async (request, response) => {
  const body = await bodyOf(request);
  if (request.url?.endsWith("/audio/transcriptions")) {
    clips.push(await clipIn(body, request.headers["content-type"] ?? ""));
    if (failing) return response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "The model isn't loaded." } }));
    response.setHeader("content-type", "application/json");
    return response.end(JSON.stringify({ text: HEARD_IN_HUNGARIAN, language: "hu" }));
  }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: translationLeftEmpty ? "" : IN_ENGLISH } }] }));
});
const voiceServerUrl = () => `http://127.0.0.1:${(voiceServer.address() as AddressInfo).port}/v1`;

const host = new TestHost();

test.beforeAll(async () => {
  await new Promise<void>((resolve) => voiceServer.listen(0, "127.0.0.1", resolve));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  voiceServer.close();
});

async function changeVoiceSettings(page: Page, change: (settings: Locator) => Promise<void>) {
  const settings = await openSettings(page, "Voice");
  await change(settings);
  await settings.getByRole("button", { name: "Close" }).click();
}

/** Keeps the microphone from recording, as while the user is asked to allow it, until allowTheMicrophone. */
const holdTheMicrophone = (page: Page) =>
  page.evaluate(() => {
    const open = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const allowed = new Promise<void>((resolve) => Object.assign(window, { allowMicrophone: resolve }));
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      await allowed;
      return open(constraints);
    };
  });
const allowTheMicrophone = (page: Page) => page.evaluate(() => (window as unknown as { allowMicrophone: () => void }).allowMicrophone());

const dictateKey = (page: Page) => page.evaluate(() => (navigator.userAgent.includes("Mac") ? "Meta" : "Control"));

test("The mic button and ⌘⇧Space dictate into the message box: a tap listens until a pause, a hold until let go, and the English goes in at the caret with what was said under it", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  const box = page.locator(".composer:visible textarea");
  const mic = page.locator(".composer:visible").getByRole("button", { name: "Dictate" });
  const problem = page.locator(".composer-area:visible .composer-problem");
  const status = page.locator(".composer-area:visible .dictation-status");
  const original = page.locator(".composer-area:visible .dictation-original");
  const primary = await dictateKey(page);

  await test.step("with speech recognition off, the mic is greyed out, and pressing it or its key says where to turn it on", async () => {
    await expect(mic).toHaveAttribute("aria-disabled", "true");
    await mic.click({ force: true });
    await expect(problem).toHaveText("Dictating needs speech recognition. Settings → Voice can turn it on.");
    await page.reload();
    await box.focus();
    await page.keyboard.press(`${primary}+Shift+Space`);
    await expect(problem).toHaveText("Dictating needs speech recognition. Settings → Voice can turn it on.");
    expect(clips).toEqual([]);
  });

  await changeVoiceSettings(page, async (settings) => {
    await useOwnVoiceServer(voiceSection(settings, "When you speak"), "Speech recognition", { url: voiceServerUrl(), model: "whisper-turbo" });
    await useOwnVoiceServer(voiceSection(settings, "Translating and summing up"), "Voice model", { url: voiceServerUrl(), model: "gemma" });
    await settings.getByLabel("You speak").selectOption({ label: "Hungarian" });
    await expect(voiceSection(settings, "When you speak").getByRole("status")).toHaveText("Saved.");
  });

  await test.step("a tap listens until the user pauses, then the English goes in at the caret, in 16 kHz mono WAV to the server, with what was said under the box", async () => {
    await expect(mic).not.toHaveAttribute("aria-disabled");
    await box.fill("Please now");
    await box.evaluate((textarea: HTMLTextAreaElement) => textarea.setSelectionRange(7, 7));
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "true");
    await expect(status).toHaveText("Listening… It stops when you pause or let go. Esc cancels.");
    await expect(box).toHaveValue(`Please ${IN_ENGLISH} now`, { timeout: 15_000 });
    await expect(mic).toHaveAttribute("aria-pressed", "false");
    await expect(status).toHaveCount(0);
    await expect(original).toContainText(`You said: ${HEARD_IN_HUNGARIAN}`);
    await expect(problem).toHaveCount(0);
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
    expect(clips[0]!.seconds, "it stopped at the pause after the speech, before the sound came round again").toBeGreaterThan(SPEECH_SECONDS + 1);
    expect(clips[0]!.seconds).toBeLessThan(SPEECH_SECONDS + SILENCE_SECONDS);
  });

  await test.step("holding the key listens through pauses until it is let go, and what was said adds up under the box", async () => {
    await box.focus();
    await box.press("End");
    await page.keyboard.down(primary);
    await page.keyboard.down("Shift");
    await page.keyboard.down("Space");
    await expect(mic).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout((SPEECH_SECONDS + 3.5) * 1_000);
    await expect(mic, "a hold doesn't stop at a pause").toHaveAttribute("aria-pressed", "true");
    await page.keyboard.up("Space");
    await page.keyboard.up("Shift");
    await page.keyboard.up(primary);
    await expect(box).toHaveValue(`Please ${IN_ENGLISH} now ${IN_ENGLISH}`, { timeout: 15_000 });
    expect(clips.at(-1)!.seconds).toBeGreaterThan(SPEECH_SECONDS + 3);
    await expect(original).toContainText(`You said: ${HEARD_IN_HUNGARIAN} ${HEARD_IN_HUNGARIAN}`);
  });

  await test.step("Esc cancels listening without sending anything, and clearing the box hides what was said", async () => {
    const heardBefore = clips.length;
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(mic).toHaveAttribute("aria-pressed", "false");
    await expect(status).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(clips).toHaveLength(heardBefore);
    await box.fill("");
    await expect(original).toHaveCount(0);
  });

  await test.step("until the microphone records, the box says it is starting, and a slow start, as while the user allows it, isn't taken for silence", async () => {
    await holdTheMicrophone(page);
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "true");
    await expect(status).toHaveText("Starting the microphone…");
    await page.waitForTimeout(NOTHING_HEARD_MS + 1_000);
    await expect(status).toHaveText("Starting the microphone…");
    await allowTheMicrophone(page);
    await expect(status).toHaveText("Listening… It stops when you pause or let go. Esc cancels.");
    await expect(box).toHaveValue(IN_ENGLISH, { timeout: 15_000 });
    await expect(problem).toHaveCount(0);
    await box.fill("");
  });

  await test.step("pressing again while the microphone starts ends that dictation, and a press after it begins the next, which goes on listening", async () => {
    await holdTheMicrophone(page);
    await mic.click();
    await expect(status).toHaveText("Starting the microphone…");
    await mic.click();
    await mic.click();
    await allowTheMicrophone(page);
    await expect(status).toHaveText("Listening… It stops when you pause or let go. Esc cancels.");
    await expect(mic).toHaveAttribute("aria-pressed", "true");
    await expect(box).toHaveValue(IN_ENGLISH, { timeout: 15_000 });
    await expect(problem).toHaveCount(0);
    await box.fill("");
  });

  await test.step("when the server fails, the message box says why", async () => {
    failing = true;
    await mic.click();
    await expect(problem).toContainText("The speech recognition server answered 500", { timeout: 15_000 });
    await expect(box).toHaveValue("");
    failing = false;
  });

  await test.step("when the voice model answers without text, the message box says so rather than taking that for what was said", async () => {
    translationLeftEmpty = true;
    await mic.click();
    await expect(problem).toHaveText("The voice model answered without text.", { timeout: 15_000 });
    await expect(box).toHaveValue("");
    await expect(original).toHaveCount(0);
    translationLeftEmpty = false;
  });

  await test.step("the key taps from a focused canvas page too, and what was said goes into the message box", async () => {
    await callCanvasTool(host, conversationId, "show", { title: "Page", html: "<p>canvas page</p>" });
    const canvasPage = page.locator(".canvas-panel:visible .canvas-frame.show iframe");
    await expect(page.frameLocator(".canvas-panel:visible .canvas-frame.show iframe").getByText("canvas page")).toBeVisible();
    await canvasPage.focus();
    await page.keyboard.press(`${primary}+Shift+Space`);
    await expect(mic).toHaveAttribute("aria-pressed", "true");
    await expect(box).toBeFocused();
    await expect(box).toHaveValue(IN_ENGLISH, { timeout: 15_000 });
    await box.fill("");
  });

  await test.step("a tap stays a tap when the page is too busy to handle the letting go at once", async () => {
    await page.evaluate(() => {
      const keepBusy = () => {
        const until = performance.now() + 700;
        while (performance.now() < until);
      };
      window.addEventListener("pointerdown", keepBusy, { once: true });
    });
    await mic.click();
    await expect(box).toHaveValue(IN_ENGLISH, { timeout: 15_000 });
    await expect(problem).toHaveCount(0);
    await box.fill("");
  });

  await changeVoiceSettings(page, async (settings) => {
    await settings.getByLabel("Send right away").check();
    await expect(voiceSection(settings, "When you speak").getByRole("status")).toHaveText("Saved.");
  });

  await test.step("with Send right away, what was said is sent once it is text, and stays under the box until the next dictation", async () => {
    await mic.click();
    await expect(page.locator(".timeline:visible .message.user").filter({ hasText: IN_ENGLISH })).toHaveCount(1, { timeout: 15_000 });
    await expect(box).toHaveValue("");
    await expect(problem).toHaveCount(0);
    await expect(original).toContainText(`You said: ${HEARD_IN_HUNGARIAN}`);
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "true");
    await expect(original).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(mic).toHaveAttribute("aria-pressed", "false");
  });
});
