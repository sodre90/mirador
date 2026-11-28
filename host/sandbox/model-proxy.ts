import { chmod, rm } from "node:fs/promises";
import { connect } from "node:net";
import { basename, dirname, join } from "node:path";
import { modelKeyVariableOf, type SandboxNetwork } from "../../shared/sandbox.ts";
import { cameThroughRelay } from "./relayed-request.ts";
import { listenOnSocket, passBothWays, refuse, type RunningSocket } from "./vm-connections.ts";

/** The model APIs the proxy speaks: Anthropic's Messages, and OpenAI's Chat Completions and Responses, as their clients call them. */
export type ModelApi = "anthropic-messages" | "openai-completions" | "openai-responses";

/** The models an agent may ask for: Claude's by a family named in the id, and the ids set on this computer exactly. */
export interface AllowedModels {
  families: readonly string[];
  ids: string[];
}

/**
 * Where one of the sandbox's agents reaches its model: its profile's API and key, which stay on this computer, the header
 * that API reads the key from, the headers its profile adds to each request, and the models it may ask for there.
 */
export interface ModelRoute {
  upstream: string;
  api: ModelApi;
  key: string;
  keyHeader: "x-api-key" | "authorization";
  headers: [string, string][];
  models: AllowedModels;
}

/** Claude Code's subagents and background calls pick a family of their own, so any of them goes. */
export const CLAUDE_FAMILIES = ["opus", "sonnet", "haiku", "fable", "mythos"] as const;

/** The variables Claude Code takes a model's id from, for its turns, subagents, workflows and background calls. */
const CLAUDE_MODEL_VARIABLES = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_CUSTOM_MODEL_OPTION",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL",
  "CLAUDE_CODE_AUTO_MODE_MODEL",
  "CLAUDE_CODE_BG_CLASSIFIER_MODEL",
];

/** The model ids a Claude agent's environment or profile names, which a gateway may serve under names of its own. */
const claudeModelIdsOf = (environment: Record<string, string>, profileModel: string | null) => [
  ...CLAUDE_MODEL_VARIABLES.flatMap((variable) => environment[variable]?.trim() || []),
  ...(profileModel ? [profileModel] : []),
];

const familiesNamedIn = (model: string) => model.toLowerCase().split(/[^a-z0-9]+/);

export const allowsModel = ({ families, ids }: AllowedModels, model: unknown) =>
  typeof model === "string" && (ids.includes(model) || familiesNamedIn(model).some((token) => families.includes(token)));

export const ANTHROPIC_API = "https://api.anthropic.com";

/** What of a route never enters the VM: its key, and the values of the headers the proxy adds. */
export const secretsOf = ({ key, headers }: ModelRoute) => [key, ...headers.map(([, value]) => value)];

/** ANTHROPIC_CUSTOM_HEADERS, as `Name: value` lines; a line with no name is skipped. */
const customHeaderLines = (text: string) =>
  text.split(/\r?\n/).flatMap((line) => {
    const colon = line.indexOf(":");
    return colon > 0 ? [[line.slice(0, colon).trim(), line.slice(colon + 1).trim()] as [string, string]] : [];
  });

/** Where a Claude agent with this environment and profile model reaches its model: its own API, else Anthropic's, with its key or setup token; null where it has none. */
export function modelRouteOf(environment: Record<string, string>, profileModel: string | null = null): ModelRoute | null {
  const keyVariable = modelKeyVariableOf(environment);
  if (!keyVariable) return null;
  return {
    upstream: environment.ANTHROPIC_BASE_URL?.trim() || ANTHROPIC_API,
    api: "anthropic-messages",
    key: environment[keyVariable]!.trim(),
    keyHeader: keyVariable === "ANTHROPIC_API_KEY" ? "x-api-key" : "authorization",
    headers: customHeaderLines(environment.ANTHROPIC_CUSTOM_HEADERS ?? ""),
    models: { families: CLAUDE_FAMILIES, ids: claudeModelIdsOf(environment, profileModel) },
  };
}

/**
 * The paths each API's clients use under its base URL, as Claude Code and pi call them; the proxy goes nowhere else. An
 * OpenAI base URL holds its `/v1` itself.
 */
const API_PATHS: Record<ModelApi, RegExp> = {
  "anthropic-messages": /^\/v1\/(?:messages(?:\/count_tokens)?|models(?:\/[A-Za-z0-9._:@-]+)?)$/,
  "openai-completions": /^\/(?:chat\/completions|models)$/,
  "openai-responses": /^\/(?:responses|models)$/,
};

/** An agent's requests come under `/p/<profile id>`, which picks the route of that agent of the room. */
const ROUTED_PATH = /^\/p\/([A-Za-z0-9-]{1,64})(\/.*)$/;

/** Headers of the agent's request that are the VM's business, or the key's place, never passed on. */
const DROPPED_HEADERS = ["host", "authorization", "x-api-key", "content-length", "connection", "keep-alive", "proxy-authorization", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade", "cookie"];

const refused = (status: number, why: string) => new Response(`${why}\n`, { status });

/** The upstream URL of an API path, under the base URL's own path where it has one. */
export function upstreamUrl(upstream: string, path: string, search: string) {
  const url = new URL(upstream);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  url.search = search;
  return url;
}

function headersFor(request: Request, route: ModelRoute) {
  const headers = new Headers(request.headers);
  DROPPED_HEADERS.forEach((name) => headers.delete(name));
  route.headers.forEach(([name, value]) => headers.set(name, value));
  headers.set(route.keyHeader, route.keyHeader === "authorization" ? `Bearer ${route.key}` : route.key);
  return headers;
}

/** The answer as the agent gets it: fetch has already undone the upstream's compression. */
function relayedAnswer(answer: Response) {
  const headers = new Headers(answer.headers);
  ["content-encoding", "content-length", "transfer-encoding", "connection"].forEach((name) => headers.delete(name));
  return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers });
}

/** The longest one model request may take, its answer streamed whole, before it is cut off. */
export const MODEL_REQUEST_MOST_MS = 30 * 60 * 1000;

/** The most a request's body may hold: the Messages API's own limit, read whole here so a VM can't hold more of this computer's memory. */
export const MODEL_REQUEST_MOST_BYTES = 32 * 1024 * 1024;

/**
 * The typed tools a closed sandbox's agents may name: those the provider runs without reaching anywhere, as Claude Code's
 * advisor and tool search. Any other runs on the provider's side, where web search, web fetch, code execution and the MCP
 * connector reach the internet; a new one is refused until it is known not to.
 */
const STAYS_IN_WITH_THE_PROVIDER = /^(?:custom|function|advisor_\d+|tool_search_tool_(?:regex|bm25)_\d+)$/;

/** Fields that have the provider reach other places by themselves: the MCP connector's servers, and Chat Completions' web search. */
const REACHING_OUT_FIELDS = ["mcp_servers", "web_search_options"];

const reachesOut = (body: Record<string, unknown>) =>
  REACHING_OUT_FIELDS.some((field) => field in body) ||
  (Array.isArray(body.tools) && body.tools.some((tool) => typeof tool?.type === "string" && !STAYS_IN_WITH_THE_PROVIDER.test(tool.type)));

/** The request's body, read to its end; null past `mostBytes`. */
async function bodyWithin(request: Request, mostBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of request.body) {
    bytes += chunk.byteLength;
    if (bytes > mostBytes) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const parsedObject = (text: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * What of a model request goes on, or why it doesn't: it names a model the route allows, and in a closed sandbox no tool
 * the provider would reach the internet with. The body goes on as read here, so a key named twice reaches the provider once.
 */
async function bodyToPassOn(request: Request, route: ModelRoute, network: SandboxNetwork): Promise<{ body: string } | { refusal: Response }> {
  const text = await bodyWithin(request, MODEL_REQUEST_MOST_BYTES);
  if (text === null) return { refusal: refused(413, "the request is larger than the model API takes") };
  const body = parsedObject(text);
  if (!body) return { refusal: refused(400, "the request is not a JSON object") };
  if (!allowsModel(route.models, body.model)) return { refusal: refused(403, `${JSON.stringify(body.model ?? null)} is not a model this agent may use from its sandbox`) };
  if (network === "closed" && reachesOut(body)) return { refusal: refused(403, "this sandbox's network is closed, so the model's tools that reach the internet are too") };
  return { body: JSON.stringify(body) };
}

/** Answers one request of the VM: only to its agents' own model API, on that API's paths, with the key added here. */
export async function proxiedModelRequest(
  request: Request,
  relayPort: number,
  routeOf: (profileId: string) => ModelRoute | null,
  networkOf: () => SandboxNetwork,
  mostMs = MODEL_REQUEST_MOST_MS,
): Promise<Response> {
  if (!cameThroughRelay(request, relayPort)) return refused(403, "only the model API, by path");
  if (request.method !== "GET" && request.method !== "POST") return refused(405, "method not allowed");
  const { pathname, search } = new URL(request.url);
  const [, profileId, path] = ROUTED_PATH.exec(pathname) ?? [];
  const route = profileId ? routeOf(profileId) : null;
  if (!route || !path || !API_PATHS[route.api].test(path)) return refused(404, "not a path of the model API");
  const passedOn = request.method === "POST" ? await bodyToPassOn(request, route, networkOf()) : { body: undefined };
  if ("refusal" in passedOn) return passedOn.refusal;
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(mostMs)]);
    const answer = await fetch(upstreamUrl(route.upstream, path, search), { method: request.method, headers: headersFor(request, route), body: passedOn.body, redirect: "manual", signal });
    return relayedAnswer(answer);
  } catch {
    return refused(502, "the model API could not be reached");
  }
}

/** How much of this computer a room's VM may hold through one socket: connections, requests at once, and seconds one may go without a byte, 0 for no end. */
export interface SocketLimits {
  mostConnections: number;
  mostAtOnce: number;
  idleSeconds: number;
}

/** A room's agents' model requests: as many at once as a few agents with their subagents make, none silent past Bun's longest idle time. */
export const MODEL_SOCKET_LIMITS: SocketLimits = { mostConnections: 128, mostAtOnce: 32, idleSeconds: 255 };

/** The answer, its slot given back once its body was read to the end, failed or was given up on. */
function givingBackWhenDone(answer: Response, giveBack: () => void): Response {
  if (!answer.body) {
    giveBack();
    return answer;
  }
  const reader = answer.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (!done) return controller.enqueue(value);
        giveBack();
        controller.close();
      } catch (error) {
        giveBack();
        controller.error(error);
      }
    },
    cancel(reason) {
      giveBack();
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: answer.status, statusText: answer.statusText, headers: answer.headers });
}

/** Bun's types leave it out of a unix socket's server, which keeps to it. A request's own `server.timeout` would end as its answer starts to stream. */
const idleTimeoutOfSocket = (seconds: number): object => ({ idleTimeout: seconds });

const TURNED_AWAY_GONE_WITHIN_MS = 10_000;
const TOO_MANY_CONNECTIONS = "too many connections at once";

/** Where Bun serves, behind the socket that counts the VM's connections, which it doesn't itself: beside it, and not shown to the VM. */
const servedBehind = (socketPath: string) => join(dirname(socketPath), `.${basename(socketPath)}`);

/** Serves a unix socket only this user of this computer reaches, made anew where an old one was left, within its limits. */
export async function serveOnSocket(socketPath: string, fetch: (request: Request) => Response | Promise<Response>, { mostConnections, mostAtOnce, idleSeconds }: SocketLimits): Promise<RunningSocket> {
  const served = servedBehind(socketPath);
  await rm(served, { force: true });
  let atOnce = 0;
  const server = Bun.serve({
    unix: served,
    ...idleTimeoutOfSocket(idleSeconds),
    async fetch(request) {
      if (atOnce >= mostAtOnce) return refused(429, "too many requests at once");
      atOnce += 1;
      let given = false;
      const giveBack = () => {
        if (given) return;
        given = true;
        atOnce -= 1;
      };
      try {
        return givingBackWhenDone(await fetch(request), giveBack);
      } catch (error) {
        giveBack();
        throw error;
      }
    },
  });
  await chmod(served, 0o600);
  const connections = await listenOnSocket(socketPath, {
    mostAtOnce: mostConnections,
    allowHalfOpen: true,
    take: (client) => passBothWays(client, connect({ path: served, allowHalfOpen: true }), 0),
    turnAway: (client) => refuse(client, "503 Service Unavailable", TOO_MANY_CONNECTIONS, TURNED_AWAY_GONE_WITHIN_MS),
  });
  return {
    async stop() {
      await connections.stop();
      await server.stop(true);
      await rm(served, { force: true });
    },
  };
}

export const startModelProxy = (
  socketPath: string,
  relayPort: number,
  routeOf: (profileId: string) => ModelRoute | null,
  networkOf: () => SandboxNetwork,
  limits = MODEL_SOCKET_LIMITS,
  mostMs = MODEL_REQUEST_MOST_MS,
) => serveOnSocket(socketPath, (request) => proxiedModelRequest(request, relayPort, routeOf, networkOf, mostMs), limits);
