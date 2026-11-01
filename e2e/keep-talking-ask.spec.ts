import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fakeMicrophone } from "./fake-microphone.ts";
import { addWorkspace, callCanvasTool, createProfile, openSettings, signIn, useOwnVoiceServer, voiceSection } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";
import { toneWav } from "./wav.ts";

test.use(fakeMicrophone);

const host = new TestHost({ fakePrograms: true });
/** The first message holds the agent's turn, so the questions come while it works on what was dictated. */
const said = () => [
  `WRITE [{"waitFor": ${JSON.stringify(join(host.root, "never"))}}]`,
  "Hear the others.",
  "The third one.",
  "Yes.",
  "Hmm.",
  "Repeat that.",
  "Help.",
  "Make it the longer wait.",
  "Stop.",
];

let heard = 0;
/** Every sentence the reply voice was asked to say, in order. */
let spoken: string[] = [];

const voiceServer = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString();
    if (request.url!.endsWith("/audio/transcriptions")) {
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify({ text: said()[heard++] ?? "Too many.", language: "en" }));
    }
    if (request.url!.endsWith("/chat/completions")) {
      response.setHeader("content-type", "application/json");
      return response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "The agent answered." }, finish_reason: "stop" }] }));
    }
    spoken.push(JSON.parse(body).input);
    response.setHeader("content-type", "audio/wav");
    response.end(toneWav(0.2));
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

test("with Keep talking, a question the agent asks is read aloud, recommended option first, and answered by voice", async ({ page }) => {
  test.setTimeout(180_000);
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
  const asked = page.locator(".timeline:visible .message.user");
  await dictate.click();
  await expect(composer.locator("textarea")).toHaveValue(said()[0]!, { timeout: 30_000 });
  await composer.locator("textarea").press("Enter");
  await expect(asked).toHaveCount(1);
  const conversationId = new URL(page.url()).hash.replace(/^#\/c\//, "");

  await test.step("the recommended option is read in full, the others on asking, and a number picks one", async () => {
    spoken = [];
    const answered = callCanvasTool(host, conversationId, "ask", {
      question: "What should signal the microphone's state?",
      options: [{ label: "Visual only" }, { label: "Short sounds", description: "A chime as it opens.", recommended: true }, { label: "Sounds plus a stronger visual" }],
    });
    expect(await answered).toContain("Sounds plus a stronger visual");
    await expect.poll(() => spoken).toEqual([
      "What should signal the microphone's state?",
      "I recommend Short sounds.",
      "A chime as it opens.",
      "Go with it, or hear the others?",
      "The others are:",
      "One: Visual only.",
      "Three: Sounds plus a stronger visual.",
      "Which one?",
      "Going with Sounds plus a stronger visual.",
    ]);
    await expect(asked, "what was said answered the question, and went to the agent as no message").toHaveCount(1);
  });

  await test.step("several questions are asked one at a time: yes takes the recommended one, thinking aloud isn't an answer, and words no option names go to the agent", async () => {
    spoken = [];
    const answered = callCanvasTool(host, conversationId, "ask", {
      questions: [
        { question: "Which signal?", options: [{ label: "Chimes (recommended)" }, { label: "Lights" }] },
        { question: "How long should it wait?", options: [{ label: "Two minutes" }, { label: "Eight seconds" }] },
      ],
    });
    await expect(page.locator(".dictation-status:visible"), "the words a question takes show while it listens").toHaveText(
      "Listening… Say “yes”, “the others”, a number, or answer in your own words.",
      { timeout: 30_000 },
    );
    const result = await answered;
    expect(result).toContain("1. Which signal?\n   The user chose: Chimes (recommended)");
    expect(result).toContain("2. How long should it wait?\n   The user chose: Make it the longer wait.\n   Their note: Answered aloud, in their own words.");
    await expect.poll(() => spoken).toEqual([
      "Question 1 of 2.",
      "Which signal?",
      "I recommend Chimes.",
      "Go with it, or hear the others?",
      "Question 2 of 2.",
      "How long should it wait?",
      "One: Two minutes.",
      "Two: Eight seconds.",
      "Which one?",
      "Say yes to take the one I recommend, the others to hear the rest, or the number of one.",
      "Anything else goes to the agent as your answer.",
      "Stop ends the conversation.",
      "Got it, I'll send those answers.",
    ]);
    expect(heard, "\"hmm\" listened on, and \"repeat that\" read the second question again, in the words it kept").toBe(8);
  });

  await test.step("\"stop\" ends it: the question stays on the canvas, waiting for an answer", async () => {
    spoken = [];
    void callCanvasTool(host, conversationId, "ask", { question: "Push now?", options: [{ label: "Yes (recommended)" }, { label: "Not yet" }] }).catch(() => {});
    await expect.poll(() => heard, { timeout: 30_000 }).toBe(9);
    await expect(dictate).toHaveAttribute("aria-pressed", "false", { timeout: 10_000 });
    await page.waitForTimeout(3_000);
    expect(heard, "the microphone didn't open again").toBe(9);
    await expect(page.locator(".canvas-outcome:visible")).toHaveText("needs your answer");
  });
});
