import { createMcpHandler, McpServer, type McpHttpHandler } from "@modelcontextprotocol/server";
import type { ServerWebSocket } from "bun";
import * as z from "zod/v4";

const PORT = Number(process.env.PORT ?? 4545);
const ORIGIN = `http://127.0.0.1:${PORT}`;

type Option = { label: string; html?: string };
type PendingAsk = { id: string; conversation: string; question: string; options: Option[]; resolve: (label: string) => void };
type AutoAnswer = { afterSeconds: number; label: string };

const pendingAsks = new Map<string, PendingAsk>();
const autoAnswers = new Map<string, AutoAnswer>();
const handlers = new Map<string, McpHttpHandler>();
const browsers = new Set<ServerWebSocket<unknown>>();
const startedAt = Date.now();

function log(event: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: ((Date.now() - startedAt) / 1000).toFixed(1), event, ...details }));
}

function broadcast(message: unknown) {
  const payload = JSON.stringify(message);
  browsers.forEach((socket) => socket.send(payload));
}

function waitForAnswer(ask: PendingAsk, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const auto = autoAnswers.get(ask.conversation);
    const autoTimer = auto && setTimeout(() => answer(ask.id, auto.label, "auto"), auto.afterSeconds * 1000);
    signal.addEventListener("abort", () => {
      if (!pendingAsks.has(ask.id)) return;
      clearTimeout(autoTimer);
      pendingAsks.delete(ask.id);
      broadcast({ type: "ask-withdrawn", id: ask.id });
      log("ask-aborted-by-client", { conversation: ask.conversation, askId: ask.id, reason: String(signal.reason) });
      reject(signal.reason);
    });
    ask.resolve = (label) => {
      clearTimeout(autoTimer);
      resolve(label);
    };
    pendingAsks.set(ask.id, ask);
    broadcast({ type: "ask", ask: { ...ask, resolve: undefined } });
  });
}

function answer(askId: string, label: string, source: "auto" | "browser") {
  const ask = pendingAsks.get(askId);
  if (!ask) return;
  pendingAsks.delete(askId);
  broadcast({ type: "ask-withdrawn", id: askId });
  log("ask-answered", { conversation: ask.conversation, askId, label, source });
  ask.resolve(label);
}

const HEARTBEAT_SECONDS = 15;

type NotifyingContext = { mcpReq: { notify: (notification: { method: string; params: Record<string, unknown> }) => Promise<void> } };

function startProgressHeartbeat(ctx: NotifyingContext, progressToken: string | number, askId: string) {
  let beats = 0;
  return setInterval(() => {
    beats += 1;
    ctx.mcpReq
      .notify({ method: "notifications/progress", params: { progressToken, progress: beats, message: "Waiting for the user's choice" } })
      .catch((error) => log("heartbeat-failed", { askId, error: String(error) }));
  }, HEARTBEAT_SECONDS * 1000);
}

function buildCanvasServer(conversation: string, era: string) {
  const server = new McpServer({ name: "canvas", version: "0.0.1" });
  server.registerTool(
    "ask",
    {
      description:
        "Show the user a visual decision in their browser and wait for their choice. Each option may carry an HTML snippet rendered as a preview.",
      inputSchema: z.object({
        question: z.string(),
        options: z.array(z.object({ label: z.string(), html: z.string().optional() })).min(2),
      }),
    },
    async ({ question, options }, ctx) => {
      const ask = { id: crypto.randomUUID(), conversation, question, options, resolve: () => {} };
      const progressToken = ctx.mcpReq._meta?.progressToken;
      log("ask-called", { conversation, era, askId: ask.id, question, progressToken: progressToken ?? null });
      const heartbeat = progressToken !== undefined && startProgressHeartbeat(ctx, progressToken, ask.id);
      try {
        const label = await waitForAnswer(ask, ctx.mcpReq.signal);
        return { content: [{ type: "text", text: `User chose: ${label}` }] };
      } finally {
        clearInterval(heartbeat || undefined);
      }
    },
  );
  return server;
}

function canvasHandlerFor(conversation: string) {
  const existing = handlers.get(conversation);
  if (existing) return existing;
  const handler = createMcpHandler(({ era }) => buildCanvasServer(conversation, era));
  handlers.set(conversation, handler);
  return handler;
}

function rememberAutoAnswer(conversation: string, url: URL) {
  const afterSeconds = url.searchParams.get("auto");
  const label = url.searchParams.get("answer");
  if (afterSeconds && label) autoAnswers.set(conversation, { afterSeconds: Number(afterSeconds), label });
}

async function serveMcp(request: Request, conversation: string) {
  const url = new URL(request.url);
  rememberAutoAnswer(conversation, url);
  const body = request.method === "POST" ? await request.clone().text() : "";
  log("mcp-http", {
    conversation,
    method: request.method,
    protocolHeader: request.headers.get("mcp-protocol-version"),
    rpc: body.match(/"method"\s*:\s*"([^"]+)"/)?.[1],
  });
  return canvasHandlerFor(conversation).fetch(request);
}

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  idleTimeout: 0,
  routes: {
    "/": new Response(Bun.file(new URL("./page.html", import.meta.url))),
    "/mcp/:conversation": (request) => serveMcp(request, request.params.conversation),
  },
  fetch(request, server) {
    if (new URL(request.url).pathname !== "/ws") return new Response("not found", { status: 404 });
    if (request.headers.get("origin") !== ORIGIN) return new Response("forbidden origin", { status: 403 });
    return server.upgrade(request) ? undefined : new Response("upgrade failed", { status: 400 });
  },
  websocket: {
    open(socket) {
      browsers.add(socket);
      pendingAsks.forEach((ask) => socket.send(JSON.stringify({ type: "ask", ask: { ...ask, resolve: undefined } })));
    },
    close(socket) {
      browsers.delete(socket);
    },
    message(_socket, raw) {
      const message = JSON.parse(String(raw));
      if (message.type === "answer") answer(message.askId, message.label, "browser");
    },
  },
});

log("host-listening", { url: ORIGIN });
