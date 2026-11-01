import { expect, test, type Locator, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { addWorkspace, openSettings, signIn, startConversation, voiceSection } from "./helpers.ts";
import { scratchPath, TestHost, writeCompiledBunProgram } from "./test-host.ts";

const files = [
  { path: "config.json", content: Buffer.from("{}"), lfs: false },
  { path: "model.safetensors", content: Buffer.alloc(40_000, 7), lfs: true },
  { path: "README.md", content: Buffer.from("# Model"), lfs: false },
];
const sha256 = (content: Buffer) => createHash("sha256").update(content).digest("hex");
const gitBlobSha1 = (content: Buffer) => createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");

let slowly = false;
let corrupted = false;
let downloaded: string[] = [];

/** Answers as Hugging Face does for any model: its files at a revision, and each file, sent slowly when a step asks for time to look. */
const huggingFace = createServer(async (request, response) => {
  const path = decodeURIComponent(request.url ?? "");
  if (/^\/api\/models\/[^/]+\/[^/]+\/tree\/[0-9a-f]+\?recursive=true$/.test(path)) {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(files.map(({ path, content, lfs }) => ({ type: "file", path, size: content.length, oid: gitBlobSha1(content), ...(lfs && { lfs: { oid: sha256(content) } }) }))));
    return;
  }
  const asked = path.match(/\/resolve\/[0-9a-f]+\/(.+)$/)?.[1];
  const file = files.find((each) => each.path === asked);
  if (!file) return response.writeHead(404).end();
  downloaded.push(path);
  const content = corrupted && file.lfs ? Buffer.alloc(file.content.length, 1) : file.content;
  if (!slowly) return response.end(content);
  for (let sent = 0; sent < content.length && !response.destroyed; sent += 1_000) {
    response.write(content.subarray(sent, sent + 1_000));
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  response.end();
});

const scratch = scratchPath("voice-engine");
const engineLog = join(scratch, "engine.log");
const fakePython = join(scratch, "python.exe");

let memoryGb = 64;

const host = new TestHost({
  environment: () => ({
    MIRADOR_VOICE_MODELS_URL: `http://127.0.0.1:${(huggingFace.address() as AddressInfo).port}`,
    MIRADOR_VOICE_PYTHON: fakePython,
    MIRADOR_VOICE_MEMORY_GB: String(memoryGb),
  }),
});

interface EngineEntry {
  module: string;
  pid: number;
  event: string;
  model?: string;
  responseFormat?: string;
  chatTemplateKwargs?: unknown;
  input?: string;
  voice?: string;
  langCode?: string;
  refAudio?: string;
  refText?: string;
}

const engineLogged = (): EngineEntry[] =>
  existsSync(engineLog)
    ? readFileSync(engineLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as EngineEntry)
    : [];

const serverPids = () =>
  engineLogged()
    .filter(({ event }) => event === "start")
    .map(({ pid }) => pid);

function isRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** What a reply's play button asks for, a sentence of its summary at a time. */
async function speakSentence(page: Page, conversationId: string, sentence: string) {
  return page.evaluate(
    async ({ conversationId, sentence }) => {
      const response = await fetch(`/conversations/${conversationId}/spoken-sentence`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: sentence });
      return { status: response.status, type: response.headers.get("content-type") };
    },
    { conversationId, sentence },
  );
}

/** What the composer will send: a clip of 16 kHz mono WAV, here a header without samples. */
async function dictate(page: Page, conversationId: string) {
  return page.evaluate(async (conversationId) => {
    const response = await fetch(`/conversations/${conversationId}/speech`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body: new Uint8Array(44) });
    return { status: response.status, body: await response.text() };
  }, conversationId);
}

test.describe.configure({ mode: "serial" });
test.skip(process.platform === "win32", "Voice on this Mac needs a Mac with Apple silicon, and its setup sizes its folder with du, which Windows lacks");
test.beforeAll(async () => {
  writeCompiledBunProgram(scratch, "python", join(import.meta.dirname, "fake-voice-engine.ts"), { FAKE_VOICE_ENGINE_LOG: engineLog, FAKE_VOICE_ENGINE_LOAD_MS: "2000" });
  await new Promise<void>((resolve) => huggingFace.listen(0, "127.0.0.1", resolve));
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  await host.cleanUp();
  huggingFace.close();
  rmSync(scratch, { recursive: true, force: true });
});

/** The model chosen in a section for this Mac, apart from the section's own choice, such as Voice model. */
const modelChosenIn = (section: Locator) => section.getByRole("combobox", { name: /^Model/ });

/** Whether the server of the model chosen in a section has it loaded. */
const serverStateIn = (section: Locator) => section.locator(".voice-engine-state");

const modelRow = (models: Locator, name: string) => models.getByRole("row").filter({ hasText: name });

test("Settings → Voice set up voice on this Mac: the download shows its progress, Cancel stops it, Remove takes it away, and a failed download says why", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, host);
  const settings = await openSettings(page, "Voice");
  const thisMac = voiceSection(settings, "Voice on this Mac");
  const models = voiceSection(settings, "Models on this Mac");
  const setUpButton = thisMac.getByRole("button", { name: "Set up voice on this Mac" });
  const progress = thisMac.getByRole("progressbar", { name: "Setting up voice on this Mac" });

  const voiceModelChoice = thisMac.getByLabel("Voice model, which translates");

  await test.step("it offers the best voice model, says how good each is, and how much disk it all takes", async () => {
    await expect(voiceModelChoice).toHaveValue("gemma-4-26b-a4b");
    await expect(voiceModelChoice.getByRole("option")).toHaveText(["None", "Gemma 4 26B-A4B · best · 15.4 GB", "Gemma 4 12B · good · 6.8 GB", "Gemma 4 E4B · fair · 5.2 GB"]);
    await expect(thisMac).toContainText("They take about 18.9 GB of disk.");
    await voiceModelChoice.selectOption({ label: "Gemma 4 12B · good · 6.8 GB" });
    await expect(thisMac).toContainText("They take about 10.3 GB of disk.");
    await voiceModelChoice.selectOption({ label: "None" });
    await expect(thisMac).toContainText("They take about 3.5 GB of disk.");
  });

  await test.step("the download shows how far it is, and Cancel stops it", async () => {
    slowly = true;
    await setUpButton.click();
    await expect(progress).toBeVisible();
    await expect(thisMac).toContainText("Downloading the models");
    await thisMac.getByRole("button", { name: "Cancel" }).click();
    await expect(setUpButton).toBeVisible();
    await expect(progress).toHaveCount(0);
  });

  await test.step("once set up, the setup box gives way to Models on this Mac, listing speech recognition beside Kokoro, and every window shows it", async () => {
    slowly = false;
    downloaded = [];
    await setUpButton.click();
    await expect(thisMac).toHaveCount(0);
    await expect(models.getByRole("table", { name: "Models on this Mac" }).getByRole("row")).toHaveText(["ModelForSize", "KokoroEnglish replies0.4 GBKept", "Whisper large-v3 turboSpeech recognition1.6 GBRemove"]);
    await expect(models).toContainText(/\d+\.\d GB in all, with the speech engine\./);
    expect(downloaded.some((path) => path.includes("gemma")), "the voice model was left out").toBe(false);
    expect(downloaded.some((path) => path.endsWith("README.md")), "readmes are left out").toBe(false);

    const otherWindow = await page.context().newPage();
    await otherWindow.goto(page.url());
    await expect(voiceSection(await openSettings(otherWindow, "Voice"), "Models on this Mac")).toContainText("Whisper large-v3 turbo");
    await otherWindow.close();
  });

  await test.step("Remove all asks again, then takes it away", async () => {
    await models.getByRole("button", { name: "Remove voice from this Mac" }).click();
    await models.getByRole("button", { name: "Confirm: Remove voice from this Mac" }).click();
    await expect(setUpButton).toBeVisible();
    await expect(models).toHaveCount(0);
  });

  await test.step("a download that comes in different is thrown away, and setup says so", async () => {
    corrupted = true;
    await setUpButton.click();
    await expect(thisMac.getByRole("alert")).toContainText("came in different from what was expected");
    await expect(thisMac.getByRole("button", { name: "Try again" })).toBeVisible();
    corrupted = false;
    await thisMac.getByRole("button", { name: "Try again" }).click();
    await expect(models).toContainText("in all, with the speech engine.");
  });
});

test("Voice on this Mac downloads each model where it is chosen, loads them when first needed and shows it beside them, and unloads them with the host and on Remove", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const conversationId = await startConversation(page);
  const settings = await openSettings(page, "Voice");
  const speaking = voiceSection(settings, "When you speak");
  const voiceModel = voiceSection(settings, "Translating and summing up");
  const replies = voiceSection(settings, "When the agent replies");
  const models = voiceSection(settings, "Models on this Mac");
  const speechRow = modelRow(models, "Whisper large-v3 turbo");
  const voiceModelRow = modelRow(models, "Gemma 4 26B-A4B");
  const smallerVoiceModelRow = modelRow(models, "Gemma 4 12B");
  const kokoroRow = modelRow(models, "Kokoro");
  const omniVoiceRow = modelRow(models, "OmniVoice");
  const recognitionChoice = speaking.getByLabel("Speech recognition");
  const recognitionState = serverStateIn(speaking);
  const voiceModelState = serverStateIn(voiceModel);
  const replyVoiceState = serverStateIn(replies);
  const lastCell = (row: Locator) => row.getByRole("cell").last();

  await test.step("speech recognition on this Mac saves at once and starts unloaded, and the voice model downloads where it is chosen, a failed try saying why beside it", async () => {
    await recognitionChoice.selectOption({ label: "On this Mac" });
    await expect(speaking.getByRole("status")).toHaveText("Saved.");
    await expect(modelChosenIn(speaking)).toHaveValue("whisper-large-v3-turbo");
    await expect(recognitionState).toHaveText("Unloaded");
    await expect(recognitionState).toHaveAttribute("data-hint", "Not holding memory now. It loads when next needed, usually in 5 to 15 seconds.");
    await expect(lastCell(speechRow)).toHaveText("In use");

    await voiceModel.getByLabel("Voice model").selectOption({ label: "On this Mac" });
    await expect(voiceModel.getByRole("status")).toHaveText("Saved.");
    await expect(modelChosenIn(voiceModel)).toHaveValue("gemma-4-26b-a4b");
    const download = voiceModel.getByRole("button", { name: "Download 15.4 GB" });
    corrupted = true;
    await download.click();
    await expect(voiceModel.getByRole("alert")).toContainText(/^Adding Gemma 4 26B-A4B failed\. .+ came in different from what was expected/);
    await expect(speechRow).toBeVisible();
    corrupted = false;
    await download.click();
    await expect(voiceModelState).toHaveText("Unloaded");
    await expect(voiceModel.getByRole("alert")).toHaveCount(0);
    await expect(voiceModelRow.getByRole("cell")).toHaveText(["Gemma 4 26B-A4B", "Voice model", "15.4 GB", "In use"]);

    await models.getByLabel("Unload after").fill("45");
    await expect(models.getByRole("status")).toHaveText("Saved.");
  });

  await test.step("the first dictation loads both, and Settings shows them loading, then loaded", async () => {
    const dictation = dictate(page, conversationId);
    await expect(recognitionState).toHaveText("Loading…");
    await expect(voiceModelState).toHaveText("Loading…");
    const { status, body } = await dictation;
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ text: "Run the e2e tests.", original: "Futtasd le az e2e teszteket.", language: "hu" });
    await expect(recognitionState).toHaveText("Loaded");
    await expect(recognitionState).toHaveAttribute("data-hint", "Loaded, so it answers at once. It unloads after 45 minutes unused, set under Models on this Mac.");
    await expect(voiceModelState).toHaveText("Loaded");
  });

  await test.step("the engine was asked for the language it heard, with this Mac's models, and not to think first", async () => {
    const logged = engineLogged();
    expect(logged.find(({ event, module }) => event === "start" && module === "mlx_lm.server")?.model).toMatch(/models\/gemma-4-26b-a4b-it-4bit$/);
    const transcriptions = logged.filter(({ event }) => event === "transcription");
    expect(transcriptions.map(({ responseFormat }) => responseFormat)).toEqual(["json", "verbose_json"]);
    expect(transcriptions.at(-1)?.model).toMatch(/models\/whisper-large-v3-turbo-asr-fp16$/);
    expect(logged.find(({ event }) => event === "chat")).toMatchObject({ model: expect.stringMatching(/models\/gemma-4-26b-a4b-it-4bit$/), chatTemplateKwargs: { enable_thinking: false } });
  });

  await test.step("choosing another voice model unloads the one in use at once, dictation says to download it, nothing can be removed while it downloads, and once downloaded it loads at the next dictation", async () => {
    await expect(voiceModelRow.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
    const biggerModelServer = engineLogged().find(({ event, module }) => event === "start" && module === "mlx_lm.server")!.pid;
    await modelChosenIn(voiceModel).selectOption({ label: "Gemma 4 12B · good · 6.8 GB" });
    await expect(voiceModel.getByRole("status")).toHaveText("Saved.");
    await expect.poll(() => isRunning(biggerModelServer)).toBe(false);
    expect(await dictate(page, conversationId)).toEqual({ status: 409, body: "Gemma 4 12B isn't on this Mac. Settings → Voice can download it." });

    const removeBiggerModel = voiceModelRow.getByRole("button", { name: "Remove Gemma 4 26B-A4B" });
    const removeAll = models.getByRole("button", { name: "Remove voice from this Mac" });
    slowly = true;
    await voiceModel.getByRole("button", { name: "Download 6.8 GB" }).click();
    await expect(removeBiggerModel).toHaveAttribute("aria-disabled", "true");
    await expect(removeBiggerModel).toHaveAttribute("data-hint", "A download is going on. Removing can start once it ends.");
    await expect(removeAll).toHaveAttribute("aria-disabled", "true");
    await removeAll.click({ force: true });
    await expect(models.getByRole("button", { name: "Confirm: Remove voice from this Mac" })).toHaveCount(0);
    slowly = false;
    await expect(voiceModelState).toHaveText("Unloaded");
    await expect(lastCell(smallerVoiceModelRow)).toHaveText("In use");
    await expect(removeBiggerModel).toBeVisible();
    await expect(removeBiggerModel).not.toHaveAttribute("aria-disabled");
    await expect(removeAll).not.toHaveAttribute("aria-disabled");

    expect(JSON.parse((await dictate(page, conversationId)).body)).toMatchObject({ text: "Run the e2e tests." });
    expect(engineLogged().filter(({ event }) => event === "chat").at(-1)?.model).toMatch(/models\/gemma-4-12B-it-4bit$/);
    await expect(voiceModelState).toHaveText("Loaded");
  });

  await test.step("a model not in use is removed after asking again, and is on offer to download again", async () => {
    await voiceModelRow.getByRole("button", { name: "Remove Gemma 4 26B-A4B" }).click();
    await voiceModelRow.getByRole("button", { name: "Confirm: Remove Gemma 4 26B-A4B" }).click();
    await expect(voiceModelRow).toHaveCount(0);
    await expect(modelChosenIn(voiceModel).getByRole("option", { name: "Gemma 4 26B-A4B · best · 15.4 GB" })).toBeAttached();
    await expect(voiceModelState).toHaveText("Loaded");
  });

  await test.step("replies spoken on this Mac come from Kokoro, on a server of their own that leaves speech recognition loaded", async () => {
    await replies.getByLabel("Read aloud").selectOption({ label: "On this Mac" });
    await expect(replies.getByRole("status")).toHaveText("Saved.");
    await expect(replies).toContainText("Spoken by Kokoro");
    await expect(lastCell(kokoroRow)).toHaveText("In use");
    expect(await speakSentence(page, conversationId, "The tests passed.")).toEqual({ status: 200, type: "audio/mpeg" });
    const spoken = engineLogged().filter(({ event }) => event === "speech");
    expect(spoken.map(({ input }) => input)).toEqual(["Ready.", "The tests passed."]);
    expect(spoken.at(-1)!.voice).toMatch(/models\/Kokoro-82M-bf16\/voices\/am_fenrir\.safetensors$/);
    expect(new Set(spoken.map(({ pid }) => pid)).size).toBe(1);
    await expect(replyVoiceState).toHaveText("Loaded");
    await expect(recognitionState).toHaveText("Loaded");
  });

  await test.step("Hungarian replies unload Kokoro, offer OmniVoice's download beside them, noted as non-commercial, and then speak in the voice of its clip", async () => {
    const kokoroServer = engineLogged().filter(({ event }) => event === "speech").at(-1)!.pid;
    await replies.getByLabel("Language").selectOption({ label: "Hungarian" });
    await expect(replies.getByRole("status")).toHaveText("Saved.");
    await expect(replies).toContainText("Spoken by OmniVoice, for non-commercial use only");
    await expect.poll(() => isRunning(kokoroServer)).toBe(false);
    await replies.getByRole("button", { name: "Download 2.0 GB" }).click();
    await expect(omniVoiceRow.getByRole("cell")).toHaveText(["OmniVoice · non-commercial use only", "Hungarian replies", "2.0 GB", "In use"]);
    await expect(lastCell(kokoroRow)).toHaveText("Kept");
    await expect(replyVoiceState).toHaveText("Unloaded");

    expect(await speakSentence(page, conversationId, "Kész a javítás.")).toEqual({ status: 200, type: "audio/mpeg" });
    const spoken = engineLogged().filter(({ event }) => event === "speech").slice(-2);
    expect(spoken.map(({ input }) => input)).toEqual(["Ready.", "Kész a javítás."]);
    expect(spoken.at(-1)).toMatchObject({
      model: expect.stringMatching(/models\/OmniVoice-bfloat16$/),
      langCode: "hu",
      refAudio: expect.stringMatching(/hungarian-voice\.wav$/),
      refText: expect.stringContaining("Fedora"),
    });
    expect(spoken.at(-1)!.voice).toBeUndefined();
    await expect(replyVoiceState).toHaveText("Loaded");
  });

  await test.step("the models unload when the host stops", async () => {
    const pids = serverPids();
    await host.restart();
    expect(pids.filter(isRunning)).toEqual([]);
    await expect(page.locator(".banner")).toHaveCount(0, { timeout: 30_000 });
    await openSettings(page, "Voice");
    await expect(recognitionState).toHaveText("Unloaded");
    await expect(voiceModelState).toHaveText("Unloaded");
  });

  await test.step("Remove all unloads them before taking them away, and dictating then says to set voice up again", async () => {
    expect(JSON.parse((await dictate(page, conversationId)).body)).toMatchObject({ text: "Run the e2e tests." });
    await expect(voiceModelState).toHaveText("Loaded");
    const pids = serverPids().filter(isRunning);
    expect(pids).toHaveLength(2);
    await models.getByRole("button", { name: "Remove voice from this Mac" }).click();
    await models.getByRole("button", { name: "Confirm: Remove voice from this Mac" }).click();
    await expect(voiceSection(settings, "Voice on this Mac").getByRole("button", { name: "Set up voice on this Mac" })).toBeVisible();
    expect(pids.filter(isRunning)).toEqual([]);
    await expect(recognitionChoice.getByRole("option", { name: "On this Mac, once set up above" })).toHaveJSProperty("disabled", true);
    expect(await dictate(page, conversationId)).toEqual({ status: 409, body: "Voice isn't set up on this Mac yet. Settings → Voice can set it up." });
  });
});

test("a Mac with less memory is offered only the voice models that fit it, and an 8 GB Mac none, with where else to translate", async ({ page }) => {
  test.setTimeout(120_000);
  const offeredOn = async (gigabytes: number) => {
    memoryGb = gigabytes;
    await host.restart();
    await signIn(page, host);
    const settings = await openSettings(page, "Voice");
    const thisMac = voiceSection(settings, "Voice on this Mac");
    return { settings, thisMac, voiceModelChoice: thisMac.getByLabel("Voice model, which translates") };
  };
  const disabled = (choice: Locator, label: string) => expect(choice.getByRole("option", { name: label, exact: true })).toHaveJSProperty("disabled", true);

  await test.step("16 GB: Gemma 4 E4B, the bigger ones saying how much memory they need", async () => {
    const { thisMac, voiceModelChoice } = await offeredOn(16);
    await expect(voiceModelChoice).toHaveValue("gemma-4-e4b");
    await disabled(voiceModelChoice, "Gemma 4 26B-A4B · best · needs a Mac with 32 GB of memory");
    await disabled(voiceModelChoice, "Gemma 4 12B · good · needs a Mac with 18 GB of memory");
    await expect(thisMac).not.toContainText("too little for a voice model");
  });

  await test.step("8 GB: none, saying why and what translates instead, and once set up this Mac's voice model stays off for lack of memory", async () => {
    const { settings, thisMac, voiceModelChoice } = await offeredOn(8);
    await expect(voiceModelChoice).toHaveValue("");
    await disabled(voiceModelChoice, "Gemma 4 E4B · fair · needs a Mac with 16 GB of memory");
    await expect(thisMac).toContainText("This Mac's 8 GB of memory is too little for a voice model of its own. A profile's API or a server of your own can translate, set below.");
    await thisMac.getByRole("button", { name: "Set up voice on this Mac" }).click();
    await expect(thisMac).toHaveCount(0);
    const voiceModel = voiceSection(settings, "Translating and summing up");
    await disabled(voiceModel.getByLabel("Voice model"), "On this Mac, too little memory");
    await expect(voiceModel.getByRole("button", { name: /^Download/ })).toHaveCount(0);
  });

  await test.step("8 GB: Hungarian replies say OmniVoice needs a bigger Mac, without a download", async () => {
    const replies = voiceSection(page.getByRole("dialog", { name: "Settings" }), "When the agent replies");
    await replies.getByLabel("Read aloud").selectOption({ label: "On this Mac" });
    await replies.getByLabel("Language").selectOption({ label: "Hungarian" });
    await expect(replies).toContainText("Spoken by OmniVoice, for non-commercial use only");
    await expect(replies).toContainText("Needs a Mac with 18 GB of memory.");
    await expect(replies.getByRole("button", { name: /^Download/ })).toHaveCount(0);
  });
});
