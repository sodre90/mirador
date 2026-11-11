import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { forgetPiAcpSessionsUnder, piProgram } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

/**
 * A reply that streams in word by word sits on the screen half-made, so a stop can catch it there. The host keeps the
 * chunks that came before the stop and hides only those a cancelled turn goes on streaming after it
 * (late-reply-after-stop.spec.ts), so what arrived stays, in the transcript and not just the page. pi forwards each
 * `text_delta` of its provider's stream as a message chunk of its own, which is why this runs the real pi against a
 * model that paces its stream: a server that sends its reply whole in one delta leaves nothing half-made to keep, and
 * a stop there shows nothing of it though the model was working the whole time.
 */
const WORDS = Array.from({ length: 60 }, (_, index) => `w${String(index + 1).padStart(2, "0")}`);
const GAP_BETWEEN_WORDS_MS = 120;

/** An OpenAI chat-completions server that sends a reply's words one at a time, so a turn can be stopped mid-stream. */
class PacedModel {
  private server?: Server;

  async start() {
    this.server = createServer((request, response) => {
      const body: Buffer[] = [];
      request.on("data", (chunk: Buffer) => body.push(chunk));
      request.on("end", () => {
        if (request.method === "GET" && request.url?.endsWith("/models")) return void answerInOneDelta(response, "paced");
        const messages = (JSON.parse(Buffer.concat(body).toString() || "{}") as { messages?: { role: string; content?: unknown }[] }).messages ?? [];
        const prompt = textOf(messages.findLast(({ role }) => role === "user"));
        if (prompt.startsWith("STREAM")) void this.streamWords(response);
        else answerInOneDelta(response, `Answer: ${prompt}`);
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
  }

  get url() {
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}/v1`;
  }

  stop() {
    this.server?.close();
  }

  private async streamWords(response: ServerResponse) {
    openStream(response);
    for (const [index, word] of WORDS.entries()) {
      await new Promise((resolve) => setTimeout(resolve, GAP_BETWEEN_WORDS_MS));
      if (response.destroyed || response.writableEnded) return;
      response.write(`data: ${JSON.stringify(delta(index ? ` ${word}` : word))}\n\n`);
    }
    endStream(response);
  }
}

const openStream = (response: ServerResponse) => response.writeHead(200, { "content-type": "text/event-stream" });

const delta = (text: string) => ({
  id: "chatcmpl-paced",
  object: "chat.completion.chunk",
  created: Math.floor(Date.now() / 1000),
  model: "paced",
  choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
});

const endStream = (response: ServerResponse) => {
  const usage = { prompt_tokens: 1_000, completion_tokens: WORDS.length, total_tokens: 1_000 + WORDS.length };
  const finish = { ...delta(""), choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage };
  response.end(`data: ${JSON.stringify(finish)}\n\ndata: [DONE]\n\n`);
};

/** The whole reply as the stream's one delta: what a model that does not pace its answer sends. */
function answerInOneDelta(response: ServerResponse, text: string) {
  openStream(response);
  response.write(`data: ${JSON.stringify(delta(text))}\n\n`);
  endStream(response);
}

const textOf = (message: { role: string; content?: unknown } | undefined) => {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === "object" && part !== null && "text" in part ? String(part.text) : "")).join("");
  return "";
};

/** pi pointed at the paced model, its settings, models and sessions all under `root`, as the scripted model's environment has it. */
function pacedPiEnvironment(model: PacedModel, root: string) {
  const agentDirectory = join(root, "pi-agent");
  mkdirSync(agentDirectory, { recursive: true });
  const provider = { baseUrl: model.url, api: "openai-completions", apiKey: "unused", models: [{ id: "paced", name: "Paced", input: ["text", "image"] }] };
  writeFileSync(join(agentDirectory, "models.json"), JSON.stringify({ providers: { e2e: provider } }));
  writeFileSync(join(agentDirectory, "settings.json"), JSON.stringify({ defaultProvider: "e2e", defaultModel: "paced" }));
  return [`PI_CODING_AGENT_DIR=${agentDirectory}`, "PI_OFFLINE=1", "npm_config_registry=http://127.0.0.1:9/", "npm_config_offline=true"].join("\n");
}

const host = new TestHost();
const model = new PacedModel();
const wordsShown = (text: string | null) => (text ?? "").trim().split(/\s+/).filter(Boolean);

/** The reply's words once the page has stopped adding to them: it re-renders a streaming reply only a few times a
 * second, so the last chunk the host holds can still be missing from the screen a moment after the turn ended. */
async function settledWords(page: Page) {
  let shown = wordsShown(await lastAgentMessage(page).textContent());
  await expect
    .poll(
      async () => {
        const now = wordsShown(await lastAgentMessage(page).textContent());
        const settled = now.join(" ") === shown.join(" ");
        shown = now;
        return settled;
      },
      { timeout: 10_000, intervals: [500] },
    )
    .toBe(true);
  return shown;
}

test.skip(piProgram() === null, "pi is not installed");
test.beforeAll(async () => {
  await model.start();
  await host.start();
});
test.afterAll(async () => {
  await host.stop();
  forgetPiAcpSessionsUnder(host.root);
  model.stop();
  await host.cleanUp();
});

test("a pi turn stopped in the middle of its streamed reply keeps the words that came in", async ({ page }) => {
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  const dialog = await createProfile(page, "paced pi", pacedPiEnvironment(model, host.root), "", "pi");
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: "paced pi · pi" });
  await startConversation(page);

  await sendMessage(page, "STREAM the words");
  await expect(lastAgentMessage(page)).toContainText(/\bw10\b/, { timeout: 60_000 });
  const beforeTheStop = wordsShown(await lastAgentMessage(page).textContent());

  await page.locator(".composer:visible textarea").press("Escape");
  await expect(page.locator(".timeline:visible").getByText("Turn ended: cancelled")).toBeVisible({ timeout: 30_000 });
  await waitForTurnToEnd(page);

  await test.step("the stop takes back no word the page had already shown", async () => {
    const onScreen = await settledWords(page);
    expect(onScreen.slice(0, beforeTheStop.length)).toEqual(beforeTheStop);
    expect(onScreen).toEqual(WORDS.slice(0, onScreen.length));
    expect(onScreen.length).toBeLessThan(WORDS.length);
  });

  await test.step("the transcript the host kept holds that half, not only the page's live copy", async () => {
    const onScreen = await settledWords(page);
    await page.reload();
    const inTranscript = wordsShown(await lastAgentMessage(page).textContent());
    expect(inTranscript.slice(0, onScreen.length)).toEqual(onScreen);
    expect(inTranscript.length).toBeLessThan(WORDS.length);
  });

  await sendMessage(page, "After the stop");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Answer: After the stop");
});
