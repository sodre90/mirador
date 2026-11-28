import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCanvasSocket } from "../host/sandbox/canvas-socket.ts";
import { CLAUDE_FAMILIES, MODEL_REQUEST_MOST_BYTES, modelRouteOf, proxiedModelRequest, startModelProxy, type ModelRoute } from "../host/sandbox/model-proxy.ts";
import type { SandboxNetwork } from "../shared/sandbox.ts";
import type { RunningSocket } from "../host/sandbox/vm-connections.ts";
import { pastTaken } from "./past-taken.ts";
import { RUNS_SANDBOXES } from "./sandbox-computer.ts";

const scratch = mkdtempSync(join(tmpdir(), "sbx-sockets-"));
const KEY = "sk-ant-the-profiles-own-key-5678";
const OAUTH_TOKEN = "sk-ant-oat01-the-setup-token-3456";
const GATEWAY_KEY = "gw-the-gateways-own-key-9012";
const MODEL_PORT = 7702;
/** A model a gateway serves under its own name, which a Claude profile's environment names. */
const GATEWAYS_MODEL = "radiance-qwen3.8-flash-next";
const CLAUDE_MODEL = "claude-opus-5-5";
const asking = (model: string, rest: object = {}) => JSON.stringify({ model, ...rest });
const CANVAS_PORT = 7701;

/** What a client in the VM writes to a relay, byte for byte, and all it gets back. */
function rawRequest(socketPath: string, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let answer = "";
    socket.on("data", (chunk) => (answer += chunk.toString()));
    socket.on("end", () => resolve(pastTaken(answer)));
    socket.on("close", () => resolve(pastTaken(answer)));
    socket.on("error", reject);
    socket.write(text.replaceAll("\n", "\r\n"));
  });
}

const statusOf = (answer: string) => Number(/^HTTP\/1\.1 (\d{3})/.exec(answer)?.[1] ?? 0);

interface Heard {
  path: string;
  search: string;
  headers: Record<string, string>;
  body: string;
}

const heardUpstream: Heard[] = [];
let upstream: ReturnType<typeof Bun.serve>;
let modelProxy: RunningSocket;
let canvasSocket: RunningSocket;
const modelSocket = join(scratch, "model.sock");
const canvasSocketPath = join(scratch, "canvas.sock");
const handledCanvas: string[] = [];
let network: SandboxNetwork = "internet";

beforeAll(async () => {
  upstream = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      heardUpstream.push({ path: url.pathname, search: url.search, headers: Object.fromEntries(request.headers), body: await request.text() });
      return Response.json({ answered: true });
    },
  });
  const routes: Record<string, ModelRoute> = {
    builder: modelRouteOf(
      {
        ANTHROPIC_API_KEY: KEY,
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstream.port}/base`,
        ANTHROPIC_CUSTOM_HEADERS: "X-Team: blue\nbroken line",
        ANTHROPIC_DEFAULT_SONNET_MODEL: GATEWAYS_MODEL,
        CLAUDE_CODE_SUBAGENT_MODEL: " kimi-k3 ",
        CLAUDE_CODE_MODEL_CATALOG_URL: "https://catalog.example/models",
      },
      "glm-5",
    )!,
    oauth: modelRouteOf({ CLAUDE_CODE_OAUTH_TOKEN: OAUTH_TOKEN, ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstream.port}` })!,
    gateway: { upstream: `http://127.0.0.1:${upstream.port}/gw/v1/`, api: "openai-responses", key: GATEWAY_KEY, keyHeader: "authorization", headers: [["X-Gateway-Team", "green"]], models: { families: [], ids: ["gpt-6.1"] } },
    chatter: { upstream: `http://127.0.0.1:${upstream.port}/v1`, api: "openai-completions", key: GATEWAY_KEY, keyHeader: "authorization", headers: [], models: { families: [], ids: ["gpt-6.1"] } },
  };
  modelProxy = await startModelProxy(modelSocket, MODEL_PORT, (profileId) => routes[profileId] ?? null, () => network);
  canvasSocket = await startCanvasSocket(canvasSocketPath, CANVAS_PORT, {
    belongs: (conversationId) => conversationId === "conversation-1" || conversationId === "conversation-2",
    tokenOf: (conversationId) => `token-of-${conversationId}`,
    handle: (conversationId) => {
      handledCanvas.push(conversationId);
      return new Response("canvas");
    },
  });
});

afterAll(async () => {
  await modelProxy.stop();
  await canvasSocket.stop();
  upstream.stop(true);
  rmSync(scratch, { recursive: true, force: true });
});

const modelRequest = (requestLine: string, host = `127.0.0.1:${MODEL_PORT}`, extra = "") => rawRequest(modelSocket, `${requestLine}\nHost: ${host}\n${extra}Connection: close\n\n`);

/** The status a JSON body posted to the model proxy gets, as a client in the VM sends it. */
const postedStatus = async (path: string, body: string) =>
  statusOf(await rawRequest(modelSocket, `POST ${path} HTTP/1.1\nHost: 127.0.0.1:${MODEL_PORT}\nContent-Type: application/json\nContent-Length: ${Buffer.byteLength(body)}\nConnection: close\n\n${body}`));

describe("a room's model proxy", () => {
  test.skipIf(!RUNS_SANDBOXES)("is a socket only this Mac user reaches", () => {
    expect(statSync(modelSocket).mode & 0o777).toBe(0o600);
    expect(statSync(canvasSocketPath).mode & 0o777).toBe(0o600);
  });

  test("passes a request on to the profile's own API with the key it keeps, and drops what the VM said of keys and cookies", async () => {
    heardUpstream.length = 0;
    const answer = await rawRequest(
      modelSocket,
      `POST /p/builder/v1/messages?beta=true HTTP/1.1\nHost: 127.0.0.1:${MODEL_PORT}\nx-api-key: kept-by-mirador\nAuthorization: Bearer something-else\nCookie: session=1\nContent-Type: application/json\nContent-Length: ${asking(CLAUDE_MODEL).length}\nConnection: close\n\n${asking(CLAUDE_MODEL)}`,
    );
    expect(statusOf(answer)).toBe(200);
    expect(answer).toContain(`{"answered":true}`);
    expect(answer).not.toContain(KEY);
    expect(heardUpstream).toHaveLength(1);
    expect(heardUpstream[0]).toMatchObject({ path: "/base/v1/messages", body: asking(CLAUDE_MODEL), headers: { "x-api-key": KEY, "x-team": "blue" } });
    expect(heardUpstream[0]!.headers.authorization).toBeUndefined();
    expect(heardUpstream[0]!.headers.cookie).toBeUndefined();
  });

  test("puts an auth or OAuth setup token in the header Anthropic's API reads it from, and forwards OAuth beta headers with the real Bearer token", async () => {
    expect(modelRouteOf({ ANTHROPIC_AUTH_TOKEN: " token ", ANTHROPIC_BASE_URL: "https://gateway.example/anthropic" })).toEqual({
      upstream: "https://gateway.example/anthropic",
      api: "anthropic-messages",
      key: "token",
      keyHeader: "authorization",
      headers: [],
      models: { families: CLAUDE_FAMILIES, ids: [] },
    });
    expect(modelRouteOf({ CLAUDE_CODE_OAUTH_TOKEN: " sk-ant-oat01-token " })).toEqual({
      upstream: "https://api.anthropic.com",
      api: "anthropic-messages",
      key: "sk-ant-oat01-token",
      keyHeader: "authorization",
      headers: [],
      models: { families: CLAUDE_FAMILIES, ids: [] },
    });
    expect(modelRouteOf({ CLAUDE_CODE_USE_BEDROCK: "1" })).toBeNull();

    heardUpstream.length = 0;
    const answer = await rawRequest(
      modelSocket,
      `POST /p/oauth/v1/messages?beta=true HTTP/1.1\nHost: 127.0.0.1:${MODEL_PORT}\nAuthorization: Bearer kept-by-mirador\nx-api-key: forged\nanthropic-beta: claude-code-20250219,oauth-2025-04-20\nContent-Type: application/json\nContent-Length: ${asking(CLAUDE_MODEL).length}\nConnection: close\n\n${asking(CLAUDE_MODEL)}`,
    );
    expect(statusOf(answer)).toBe(200);
    expect(answer).not.toContain(OAUTH_TOKEN);
    expect(heardUpstream).toHaveLength(1);
    expect(heardUpstream[0]).toMatchObject({
      path: "/v1/messages",
      search: "?beta=true",
      body: asking(CLAUDE_MODEL),
      headers: { authorization: `Bearer ${OAUTH_TOKEN}`, "anthropic-beta": "claude-code-20250219,oauth-2025-04-20" },
    });
    expect(heardUpstream[0]!.headers["x-api-key"]).toBeUndefined();
  });

  test("refuses CONNECT, and any request addressed to another host", async () => {
    heardUpstream.length = 0;
    expect(statusOf(await modelRequest("CONNECT example.com:443 HTTP/1.1", "example.com:443"))).toBeGreaterThanOrEqual(400);
    expect(statusOf(await modelRequest("GET http://example.com/p/builder/v1/models HTTP/1.1", "example.com"))).toBe(403);
    expect(statusOf(await modelRequest("GET /p/builder/v1/models HTTP/1.1", "example.com"))).toBe(403);
    expect(statusOf(await modelRequest("GET /p/builder/v1/models HTTP/1.1", "127.0.0.1:9999"))).toBe(403);
    expect(heardUpstream).toEqual([]);
  });

  test("goes on to the profile's own API even where a full address names another host", async () => {
    heardUpstream.length = 0;
    expect(statusOf(await modelRequest("GET http://example.com/p/builder/v1/models HTTP/1.1"))).toBe(200);
    expect(heardUpstream.map(({ path }) => path)).toEqual(["/base/v1/models"]);
  });

  test("goes nowhere but the model API's own paths, of an agent of the room", async () => {
    heardUpstream.length = 0;
    for (const path of ["/v1/messages", "/p/builder/v1/files", "/p/builder/v1/messages/../../../admin", "/p/builder/%2e%2e/v1/messages", "/p/stranger/v1/messages", "/p/builder", "/"]) {
      expect({ path, status: statusOf(await modelRequest(`GET ${path} HTTP/1.1`)) }).toEqual({ path, status: 404 });
    }
    expect(statusOf(await modelRequest("PUT /p/builder/v1/messages HTTP/1.1"))).toBe(405);
    expect(heardUpstream).toEqual([]);
  });

  test("passes an OpenAI Responses request on under the gateway's /v1, with the key as a bearer token and the profile's headers, never the VM's", async () => {
    heardUpstream.length = 0;
    const answer = await rawRequest(
      modelSocket,
      `POST /p/gateway/responses HTTP/1.1\nHost: 127.0.0.1:${MODEL_PORT}\nAuthorization: Bearer kept-by-mirador\nx-api-key: kept-by-mirador\nX-Gateway-Team: forged\nx-pi-session-id: s-1\nContent-Type: application/json\nContent-Length: ${asking("gpt-6.1").length}\nConnection: close\n\n${asking("gpt-6.1")}`,
    );
    expect(statusOf(answer)).toBe(200);
    expect(answer).not.toContain(GATEWAY_KEY);
    expect(heardUpstream).toHaveLength(1);
    expect(heardUpstream[0]).toMatchObject({ path: "/gw/v1/responses", body: asking("gpt-6.1"), headers: { authorization: `Bearer ${GATEWAY_KEY}`, "x-gateway-team": "green", "x-pi-session-id": "s-1" } });
    expect(heardUpstream[0]!.headers["x-api-key"]).toBeUndefined();
    expect(statusOf(await modelRequest("GET /p/gateway/models HTTP/1.1"))).toBe(200);
    expect(await postedStatus("/p/chatter/chat/completions", asking("gpt-6.1"))).toBe(200);
    expect(heardUpstream.map(({ path }) => path)).toEqual(["/gw/v1/responses", "/gw/v1/models", "/v1/chat/completions"]);
  });

  test("goes nowhere on an OpenAI route but its own API's paths: not Anthropic's, nor another OpenAI API's, nor anything else under the base URL", async () => {
    heardUpstream.length = 0;
    const refused = ["/p/gateway/v1/messages", "/p/gateway/chat/completions", "/p/gateway/v1/responses", "/p/gateway/responses/abc", "/p/gateway/files", "/p/gateway/models/gpt", "/p/gateway/", "/p/chatter/responses", "/p/chatter/v1/chat/completions", "/p/chatter/embeddings"];
    for (const path of refused) {
      expect({ path, status: statusOf(await modelRequest(`POST ${path} HTTP/1.1`, undefined, "Content-Length: 0\n")) }).toEqual({ path, status: 404 });
    }
    expect(heardUpstream).toEqual([]);
  });

  test("asks only for a Claude family, a model its profile or environment names, or on an OpenAI route a model the VM was given", async () => {
    heardUpstream.length = 0;
    for (const model of [CLAUDE_MODEL, "claude-haiku-5-5", "claude-3-opus-20240229", "us.anthropic.claude-sonnet-5-5-v1:0", "claude-fable-5-2", GATEWAYS_MODEL, "kimi-k3", "glm-5"]) {
      expect({ model, status: await postedStatus("/p/builder/v1/messages", asking(model)) }).toEqual({ model, status: 200 });
    }
    expect(await postedStatus("/p/builder/v1/messages/count_tokens", asking(GATEWAYS_MODEL))).toBe(200);
    for (const model of ["gpt-6.1", "claude-opusplus-1", "qwen3-coder", "https://catalog.example/models", ""]) {
      expect({ model, status: await postedStatus("/p/builder/v1/messages", asking(model)) }).toEqual({ model, status: 403 });
    }
    expect(await postedStatus("/p/oauth/v1/messages", asking(GATEWAYS_MODEL))).toBe(403);
    expect(await postedStatus("/p/builder/v1/messages", "{}")).toBe(403);
    expect(await postedStatus("/p/builder/v1/messages", `[${asking(CLAUDE_MODEL)}]`)).toBe(400);
    expect(await postedStatus("/p/builder/v1/messages", "model=claude-opus-5-5")).toBe(400);
    expect(await postedStatus("/p/gateway/responses", asking(CLAUDE_MODEL))).toBe(403);
    expect(await postedStatus("/p/gateway/responses", asking("gpt-6.1-pro"))).toBe(403);
    expect(heardUpstream).toHaveLength(9);
  });

  test("in a closed sandbox, refuses the model's tools that reach the internet, from the next request on once it closes", async () => {
    const anthropicTools = (...types: string[]) => asking(CLAUDE_MODEL, { tools: types.map((type) => ({ type, name: type.replace(/_\d+$/, "") })) });
    const ownTool = { name: "Bash", description: "Runs a command", input_schema: { type: "object" } };
    const webSearch = anthropicTools("web_search_20250305");
    heardUpstream.length = 0;
    expect(await postedStatus("/p/builder/v1/messages", webSearch)).toBe(200);
    network = "closed";
    try {
      for (const type of ["web_search_20250305", "web_search_20260209", "web_fetch_20260209", "code_execution_20260521", "mcp_toolset", "computer_toolset_20260801", "a_tool_of_tomorrow_20270101"]) {
        expect({ type, status: await postedStatus("/p/builder/v1/messages", anthropicTools(type)) }).toEqual({ type, status: 403 });
      }
      expect(await postedStatus("/p/builder/v1/messages", asking(CLAUDE_MODEL, { mcp_servers: [{ type: "url", url: "https://example.com/mcp", name: "x" }] }))).toBe(403);
      expect(await postedStatus("/p/gateway/responses", asking("gpt-6.1", { tools: [{ type: "web_search" }] }))).toBe(403);
      expect(await postedStatus("/p/gateway/responses", asking("gpt-6.1", { tools: [{ type: "mcp", server_url: "https://example.com/mcp" }] }))).toBe(403);
      expect(await postedStatus("/p/gateway/responses", asking("gpt-6.1", { tools: [{ type: "code_interpreter" }] }))).toBe(403);
      expect(await postedStatus("/p/chatter/chat/completions", asking("gpt-6.1", { web_search_options: {} }))).toBe(403);

      expect(await postedStatus("/p/builder/v1/messages", asking(CLAUDE_MODEL, { tools: [ownTool, { type: "advisor_20260301", name: "advisor" }, { type: "tool_search_tool_regex_20251119", name: "tool_search_tool_regex" }] }))).toBe(200);
      expect(await postedStatus("/p/gateway/responses", asking("gpt-6.1", { tools: [{ type: "function", name: "bash" }, { type: "custom", name: "patch" }] }))).toBe(200);
      const namedTwice = `{"model":"${CLAUDE_MODEL}","tools":[{"type":"web_search_20250305","name":"web_search"}],"tools":[]}`;
      expect(await postedStatus("/p/builder/v1/messages", namedTwice)).toBe(200);
      expect(heardUpstream.at(-1)!.body).toBe(JSON.stringify({ model: CLAUDE_MODEL, tools: [] }));
      expect(await postedStatus("/p/builder/v1/messages", `{"model":"${CLAUDE_MODEL}","tools":[],"tools":[{"type":"web_search_20250305","name":"web_search"}]}`)).toBe(403);
    } finally {
      network = "internet";
    }
    expect(await postedStatus("/p/builder/v1/messages", webSearch)).toBe(200);
    expect(heardUpstream).toHaveLength(5);
  });

  test("refuses a body larger than the model API takes, without reading on", async () => {
    const tooLarge = new Request(`http://127.0.0.1:${MODEL_PORT}/p/builder/v1/messages`, { method: "POST", headers: { host: `127.0.0.1:${MODEL_PORT}` }, body: "x".repeat(MODEL_REQUEST_MOST_BYTES + 1) });
    const route = modelRouteOf({ ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstream.port}` })!;
    heardUpstream.length = 0;
    expect((await proxiedModelRequest(tooLarge, MODEL_PORT, () => route, () => "internet")).status).toBe(413);
    expect(heardUpstream).toEqual([]);
  });
});

const canvasRequest = (path: string, token: string | null, extra = "", host = `127.0.0.1:${CANVAS_PORT}`) =>
  rawRequest(canvasSocketPath, `POST ${path} HTTP/1.1\nHost: ${host}\n${token === null ? "" : `Authorization: Bearer ${token}\n`}${extra}Content-Length: 0\nConnection: close\n\n`);

describe("a room's canvas socket", () => {
  test("serves a conversation of the room its canvas, with that conversation's token", async () => {
    handledCanvas.length = 0;
    expect(statusOf(await canvasRequest("/mcp/conversation-1", "token-of-conversation-1"))).toBe(200);
    expect(handledCanvas).toEqual(["conversation-1"]);
  });

  test("refuses another conversation's token, and none", async () => {
    handledCanvas.length = 0;
    expect(statusOf(await canvasRequest("/mcp/conversation-1", "token-of-conversation-2"))).toBe(401);
    expect(statusOf(await canvasRequest("/mcp/conversation-1", null))).toBe(401);
    expect(handledCanvas).toEqual([]);
  });

  test("serves nothing but the canvas of the room's conversations", async () => {
    handledCanvas.length = 0;
    for (const path of ["/mcp/conversation-of-another-room", "/auth?token=anything", "/", "/sessions/s/messages", "/mcp/conversation-1/extra", "/mcp/../auth"]) {
      expect({ path, status: statusOf(await canvasRequest(path, "token-of-conversation-1")) }).toEqual({ path, status: 404 });
    }
    expect(handledCanvas).toEqual([]);
  });

  test("refuses a browser's request, a WebSocket, and one addressed elsewhere", async () => {
    handledCanvas.length = 0;
    expect(statusOf(await canvasRequest("/mcp/conversation-1", "token-of-conversation-1", "Origin: http://127.0.0.1:4600\n"))).toBe(403);
    expect(statusOf(await canvasRequest("/mcp/conversation-1", "token-of-conversation-1", "Upgrade: websocket\n"))).toBe(403);
    expect(statusOf(await canvasRequest("/mcp/conversation-1", "token-of-conversation-1", "", "127.0.0.1:4600"))).toBe(403);
    expect(handledCanvas).toEqual([]);
  });
});

describe("a room's model proxy holds only so much of this Mac", () => {
  const routeTo = (port: number): ModelRoute => ({ upstream: `http://127.0.0.1:${port}`, api: "anthropic-messages", key: KEY, keyHeader: "x-api-key", headers: [], models: { families: CLAUDE_FAMILIES, ids: [] } });
  const askedThrough = (socket: string) =>
    rawRequest(socket, `POST /p/builder/v1/messages HTTP/1.1\nHost: 127.0.0.1:${MODEL_PORT}\nContent-Length: ${asking(CLAUDE_MODEL).length}\nConnection: close\n\n${asking(CLAUDE_MODEL)}`);

  test("takes so many requests at once, refuses more, and takes one again once an answer was read to its end", async () => {
    const releases: (() => void)[] = [];
    const slow = Bun.serve({
      port: 0,
      fetch: () => new Promise<Response>((resolve) => releases.push(() => resolve(Response.json({ answered: true })))),
    });
    const socket = join(scratch, "limited.sock");
    const proxy = await startModelProxy(socket, MODEL_PORT, () => routeTo(slow.port!), () => "internet", { mostConnections: 128, mostAtOnce: 2, idleSeconds: 255 });
    try {
      const first = askedThrough(socket);
      const second = askedThrough(socket);
      while (releases.length < 2) await Bun.sleep(10);

      expect(statusOf(await askedThrough(socket))).toBe(429);
      releases.shift()!();
      expect(statusOf(await first)).toBe(200);
      const third = askedThrough(socket);
      while (releases.length < 2) await Bun.sleep(10);
      releases.forEach((release) => release());
      expect([statusOf(await second), statusOf(await third)]).toEqual([200, 200]);
    } finally {
      await proxy.stop();
      slow.stop(true);
    }
  });

  test("cuts off a request the model API takes too long over, and gives its place back", async () => {
    const silent = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
    const socket = join(scratch, "timed.sock");
    const proxy = await startModelProxy(socket, MODEL_PORT, () => routeTo(silent.port!), () => "internet", { mostConnections: 128, mostAtOnce: 1, idleSeconds: 255 }, 200);
    try {
      expect(statusOf(await askedThrough(socket))).toBe(502);
      expect(statusOf(await askedThrough(socket))).toBe(502);
    } finally {
      await proxy.stop();
      silent.stop(true);
    }
  });
});

describe("a sandbox's VM holds only so many connections", () => {
  const TURNED_AWAY = 64;

  /** A connection that asks nothing, or no more than it did, and is never let go of by the VM. */
  async function held(path: string, said = ""): Promise<Socket> {
    const socket = connect(path);
    socket.on("error", () => {});
    await new Promise((open) => socket.once("connect", open));
    socket.write(said);
    return socket;
  }

  async function untilAnswered(status: number, ask: () => Promise<string>) {
    while (statusOf(await ask()) !== status) await Bun.sleep(20);
  }

  test("to its model and to its canvas, idle ones and those refused a request counted: one more is told so, many more end without a word, and one is taken again once another ended", async () => {
    const [model, canvas] = [join(scratch, "model-counted.sock"), join(scratch, "canvas-counted.sock")];
    const sockets = [
      await startModelProxy(model, MODEL_PORT, () => null, () => "internet", { mostConnections: 3, mostAtOnce: 32, idleSeconds: 255 }),
      await startCanvasSocket(canvas, CANVAS_PORT, { belongs: () => false, tokenOf: () => "", handle: () => new Response() }, { mostConnections: 3, mostAtOnce: 64, idleSeconds: 0 }),
    ];
    for (const path of [model, canvas]) {
      const refusedOnce = "GET /nowhere HTTP/1.1\r\nHost: elsewhere\r\n\r\n";
      const ask = () => rawRequest(path, "GET /nowhere HTTP/1.1\nHost: elsewhere\nConnection: close\n\n").catch(() => "");
      expect(statusOf(await ask())).toBe(403);
      const idle = [await held(path), await held(path, refusedOnce), await held(path, "GET /half")];
      await untilAnswered(503, ask);
      expect(await ask()).toContain("too many connections at once");

      const waiting = await Promise.all(Array.from({ length: TURNED_AWAY }, () => held(path)));
      await Bun.sleep(100);
      expect(await ask()).toBe("");

      [...waiting, idle[0]!].forEach((socket) => socket.destroy());
      await untilAnswered(403, ask);
      idle.forEach((socket) => socket.destroy());
    }
    await Promise.all(sockets.map((socket) => socket.stop()));
  }, 20_000);

  test("each a request may come over again, one that has said all it will is answered, and a request given up on ends where it went", async () => {
    const gone = Promise.withResolvers<void>();
    const path = join(scratch, "canvas-again.sock");
    const socket = await startCanvasSocket(path, CANVAS_PORT, {
      belongs: () => true,
      tokenOf: () => "token",
      handle: (conversationId, request) => {
        if (conversationId !== "waits") return new Response("canvas");
        request.signal.addEventListener("abort", () => gone.resolve());
        return new Response(new ReadableStream({ start: (controller) => controller.enqueue("begun") }));
      },
    });
    const asked = (conversationId: string) => `GET /mcp/${conversationId} HTTP/1.1\r\nHost: 127.0.0.1:${CANVAS_PORT}\r\nAuthorization: Bearer token\r\n\r\n`;
    const client = await held(path);
    let heard = "";
    client.on("data", (chunk) => (heard += chunk.toString()));
    for (const times of [1, 2]) {
      client.write(asked("answers"));
      while (heard.split("canvas").length <= times) await Bun.sleep(10);
    }
    const saidAll = connect({ path, allowHalfOpen: true });
    let toSaidAll = "";
    saidAll.on("data", (chunk) => (toSaidAll = pastTaken(toSaidAll + chunk.toString())));
    saidAll.end(asked("answers"));
    while (!toSaidAll.includes("canvas")) await Bun.sleep(10);
    expect(statusOf(toSaidAll)).toBe(200);
    saidAll.destroy();

    client.write(asked("waits"));
    while (!heard.includes("begun")) await Bun.sleep(10);
    client.destroy();
    await gone.promise;
    await socket.stop();
  });
});

describe("an answer that falls silent for longer than the ten seconds Bun gives a request by itself", () => {
  const SILENT_MS = 13_000;

  async function beginsThenEndsAfterSilence(request: Request) {
    await request.text();
    await Bun.sleep(50);
    const body = new ReadableStream<string>({
      async start(controller) {
        controller.enqueue("begun ");
        await Bun.sleep(SILENT_MS);
        controller.enqueue("ended");
        controller.close();
      },
    });
    return new Response(body);
  }
  const chunksIn = (answer: string) =>
    answer
      .slice(answer.indexOf("\r\n\r\n") + 4)
      .split("\r\n")
      .filter((_, index) => index % 2 === 1);
  const wholeAnswer = async (socket: string, port: number, path: string, headers = "") =>
    chunksIn(await rawRequest(socket, `POST ${path} HTTP/1.1\nHost: 127.0.0.1:${port}\n${headers}Content-Length: ${asking(CLAUDE_MODEL).length}\nConnection: close\n\n${asking(CLAUDE_MODEL)}`)).join("");

  test("comes whole, a model's that thinks and a canvas question's that waits for its answer", async () => {
    const thinking = Bun.serve({ port: 0, idleTimeout: 0, fetch: beginsThenEndsAfterSilence });
    const [model, canvas] = [join(scratch, "thinking.sock"), join(scratch, "waiting.sock")];
    const sockets = await Promise.all([
      startModelProxy(
        model,
        MODEL_PORT,
        () => ({ upstream: `http://127.0.0.1:${thinking.port}`, api: "anthropic-messages", key: KEY, keyHeader: "x-api-key", headers: [], models: { families: CLAUDE_FAMILIES, ids: [] } }),
        () => "internet",
      ),
      startCanvasSocket(canvas, CANVAS_PORT, { belongs: () => true, tokenOf: () => "token", handle: (_conversationId, request) => beginsThenEndsAfterSilence(request) }),
    ]);
    try {
      const answers = await Promise.all([
        wholeAnswer(model, MODEL_PORT, "/p/builder/v1/messages"),
        wholeAnswer(canvas, CANVAS_PORT, "/mcp/conversation-1", "Authorization: Bearer token\n"),
      ]);
      expect(answers).toEqual(["begun ended", "begun ended"]);
    } finally {
      await Promise.all(sockets.map((socket) => socket.stop()));
      thinking.stop(true);
    }
  }, 30_000);
});
