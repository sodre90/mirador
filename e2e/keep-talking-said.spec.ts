import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fakeMicrophone } from "./fake-microphone.ts";
import { addWorkspace, createProfile, dictateInto, openSettings, signIn, useOwnVoiceServer, voiceSection } from "./helpers.ts";
import { TestHost, writeBunProgram } from "./test-host.ts";
import { toneWav } from "./wav.ts";

test.use(fakeMicrophone);

const host = new TestHost({ fakePrograms: true });
const firstDone = () => join(host.root, "first-done");
/** The first message's turn ends without a reply once its file exists; the third asks to run a tool. */
const said = () => [`WRITE [{"waitFor": ${JSON.stringify(firstDone())}}]`, "Repeat that.", `TOOLS [{"kind": "execute", "title": "Deploy the site"}]`, "Thank you."];

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

test("with Keep talking, a turn without a reply, nothing to repeat and an approval waiting are said aloud", async ({ page }) => {
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
  await dictateInto(composer, said()[0]!, () => heard);
  await composer.locator("textarea").press("Enter");
  await expect(asked).toHaveCount(1);

  await test.step("a turn that ends without a reply says so, and the microphone opens again", async () => {
    spoken = [];
    writeFileSync(firstDone(), "");
    await expect.poll(() => spoken, { timeout: 30_000 }).toEqual(["The agent stopped without a reply."]);
  });

  await test.step("\"repeat that\" with no reply read yet says there is nothing to repeat, and goes on listening", async () => {
    await expect.poll(() => spoken, { timeout: 30_000 }).toEqual(["The agent stopped without a reply.", "There is no reply to repeat yet."]);
    await expect(asked).toHaveCount(1);
  });

  await test.step("an approval only the screen can give is said once; once given, the reply is read", async () => {
    await expect(asked).toHaveCount(2, { timeout: 30_000 });
    await expect.poll(() => spoken.slice(2), { timeout: 30_000 }).toEqual(["The agent is waiting for your approval on the screen."]);
    await page.waitForTimeout(3_000);
    expect(spoken.slice(2), "said only once").toEqual(["The agent is waiting for your approval on the screen."]);
    await page.locator(".timeline:visible .permission.pending").getByRole("button", { name: "Allow", exact: true }).click();
    await expect.poll(() => spoken.slice(3), { timeout: 30_000 }).toEqual(["The agent answered."]);
  });

  await test.step("a lone \"thank you\" ends the conversation", async () => {
    await expect.poll(() => heard, { timeout: 30_000 }).toBe(4);
    await expect(dictate).toHaveAttribute("aria-pressed", "false", { timeout: 30_000 });
    await page.waitForTimeout(3_000);
    await expect(asked).toHaveCount(2);
  });
});
