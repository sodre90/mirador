import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { addWorkspace, createProfile, lastAgentMessage, sendMessage, signIn, startConversation, waitForTurnToEnd } from "./helpers.ts";
import { forgetPiAcpSessionsUnder, piProgram } from "./scripted-model.ts";
import { TestHost } from "./test-host.ts";

/**
 * Two ways a model's reply comes to a pi conversation, and what the screen holds of each.
 *
 * A reply that streams in word by word sits on the screen half-made, so a stop can catch it there. The host keeps the
 * chunks that came before the stop and hides only those a cancelled turn goes on streaming after it
 * (late-reply-after-stop.spec.ts), so what arrived stays, in the transcript and not just the page.
 *
 * A reply a server reports only as a finished item never streams at all: llama.cpp's `/v1/responses` answers with
 * `response.output_item.added` and `.done` with no `response.output_text.delta` between them, pi turns only those
 * deltas into the events pi-acp forwards, and the item's text goes by on `text_end`, which pi-acp answers with the
 * words no delta ever carried. Without that a conversation of this model shows no reply at all, however long it ran.
 *
 * Both run the real pi, because it is pi's provider that turns a model's stream into the events pi-acp reads.
 */
const WORDS = Array.from({ length: 60 }, (_, index) => `w${String(index + 1).padStart(2, "0")}`);
const GAP_BETWEEN_WORDS_MS = 120;

/** A model replying two ways: word by word on the chat-completions route, and as one finished item on the responses route. */
class ModelServer {
  private server?: Server;

  async start() {
    this.server = createServer((request, response) => {
      const bodyParts: Buffer[] = [];
      request.on("data", (chunk: Buffer) => bodyParts.push(chunk));
      request.on("end", () => {
        if (request.method === "GET" && request.url?.endsWith("/models")) return void answerInOneDelta(response, "paced");
        const prompt = promptIn(JSON.parse(Buffer.concat(bodyParts).toString() || "{}"));
        if (request.url?.endsWith("/responses")) answerInOneItem(response, `Answer: ${prompt}`);
        else if (prompt.startsWith("STREAM")) void this.streamWords(response);
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

/** The whole reply as the stream's one delta. */
function answerInOneDelta(response: ServerResponse, text: string) {
  openStream(response);
  response.write(`data: ${JSON.stringify(delta(text))}\n\n`);
  endStream(response);
}

/** The reply only when its item is finished, with no delta between its add and its done. */
function answerInOneItem(response: ServerResponse, text: string) {
  const message = (content: object[]) => ({ type: "message", role: "assistant", id: "msg_paced", content });
  const usage = { input_tokens: 1_000, output_tokens: 8, total_tokens: 1_008 };
  const frames = [
    { type: "response.created", response: { id: "resp_paced" } },
    { type: "response.output_item.added", output_index: 0, item: message([]) },
    { type: "response.output_item.done", output_index: 0, item: message([{ type: "output_text", text }]) },
    { type: "response.completed", response: { id: "resp_paced", status: "completed", usage } },
  ];
  openStream(response);
  response.end(frames.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(""));
}

const textOf = (turn: { role?: string; content?: unknown } | undefined) => {
  const content = turn?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === "object" && part !== null && "text" in part ? String(part.text) : "")).join("");
  return "";
};

/** What the user last said, in a chat-completions `messages` array or a Responses `input` one. */
const promptIn = (body: { messages?: unknown; input?: unknown }) => {
  const turns = (Array.isArray(body.messages) ? body.messages : body.input) as { role?: string }[] | undefined;
  return textOf(turns?.findLast(({ role }) => role === "user"));
};

/** pi pointed at the model over `api`, its settings, models and sessions all under `agents`, as the scripted model's environment has it. */
function piEnvironmentOf(model: ModelServer, agents: string, api: "openai-completions" | "openai-responses") {
  const agentDirectory = join(host.root, agents);
  mkdirSync(agentDirectory, { recursive: true });
  const provider = { baseUrl: model.url, api, apiKey: "unused", models: [{ id: "paced", name: "Paced", input: ["text", "image"] }] };
  writeFileSync(join(agentDirectory, "models.json"), JSON.stringify({ providers: { e2e: provider } }));
  writeFileSync(join(agentDirectory, "settings.json"), JSON.stringify({ defaultProvider: "e2e", defaultModel: "paced" }));
  return [`PI_CODING_AGENT_DIR=${agentDirectory}`, "PI_OFFLINE=1", "npm_config_registry=http://127.0.0.1:9/", "npm_config_offline=true"].join("\n");
}

const host = new TestHost();
const model = new ModelServer();
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
let page: Page;
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ browser }) => {
  await model.start();
  await host.start();
  page = await browser.newPage();
  await signIn(page, host);
  await addWorkspace(page, host.projectDir);
  for (const [name, agents, api] of [["paced pi", "pi-agent", "openai-completions"], ["whole item pi", "pi-agent-items", "openai-responses"]] as const) {
    const profiles = await createProfile(page, name, piEnvironmentOf(model, agents, api), "", "pi");
    await profiles.getByRole("button", { name: "Close" }).click();
  }
});
test.afterAll(async () => {
  await page.close();
  await host.stop();
  forgetPiAcpSessionsUnder(host.root);
  model.stop();
  await host.cleanUp();
});

/** A conversation of its own on the pi profile named `agent`. */
async function startOn(agent: string) {
  await page.getByLabel("Agent", { exact: true }).selectOption({ label: `${agent} · pi` });
  return startConversation(page);
}

test("a pi turn stopped in the middle of its streamed reply keeps the words that came in", async () => {
  await startOn("paced pi");

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

test("a pi turn against a server that reports its reply only as a finished item shows that reply", async () => {
  await startOn("whole item pi");
  await sendMessage(page, "Say it as one item");
  await waitForTurnToEnd(page);
  await expect(lastAgentMessage(page)).toContainText("Answer: Say it as one item");
});
