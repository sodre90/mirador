import { chmod, rm } from "node:fs/promises";
import { modelKeyVariableOf } from "../../shared/sandbox.ts";
import { cameThroughRelay } from "./relayed-request.ts";

/** The model APIs the proxy speaks: Anthropic's Messages, and OpenAI's Chat Completions and Responses, as their clients call them. */
export type ModelApi = "anthropic-messages" | "openai-completions" | "openai-responses";

/**
 * Where one of the sandbox's agents reaches its model: its profile's API and key, which stay on this computer, the header
 * that API reads the key from, and the headers its profile adds to each request.
 */
export interface ModelRoute {
  upstream: string;
  api: ModelApi;
  key: string;
  keyHeader: "x-api-key" | "authorization";
  headers: [string, string][];
}

export const ANTHROPIC_API = "https://api.anthropic.com";

/** What of a route never enters the VM: its key, and the values of the headers the proxy adds. */
export const secretsOf = ({ key, headers }: ModelRoute) => [key, ...headers.map(([, value]) => value)];

/** ANTHROPIC_CUSTOM_HEADERS, as `Name: value` lines; a line with no name is skipped. */
const customHeaderLines = (text: string) =>
  text.split(/\r?\n/).flatMap((line) => {
    const colon = line.indexOf(":");
    return colon > 0 ? [[line.slice(0, colon).trim(), line.slice(colon + 1).trim()] as [string, string]] : [];
  });

/** Where a Claude agent with this environment reaches its model: its own API, else Anthropic's, with its key; null where it has no key. */
export function modelRouteOf(environment: Record<string, string>): ModelRoute | null {
  const keyVariable = modelKeyVariableOf(environment);
  if (!keyVariable) return null;
  return {
    upstream: environment.ANTHROPIC_BASE_URL?.trim() || ANTHROPIC_API,
    api: "anthropic-messages",
    key: environment[keyVariable]!.trim(),
    keyHeader: keyVariable === "ANTHROPIC_API_KEY" ? "x-api-key" : "authorization",
    headers: customHeaderLines(environment.ANTHROPIC_CUSTOM_HEADERS ?? ""),
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

/** Answers one request of the VM: only to its agents' own model API, on that API's paths, with the key added here. */
export async function proxiedModelRequest(request: Request, relayPort: number, routeOf: (profileId: string) => ModelRoute | null, mostMs = MODEL_REQUEST_MOST_MS): Promise<Response> {
  if (!cameThroughRelay(request, relayPort)) return refused(403, "only the model API, by path");
  if (request.method !== "GET" && request.method !== "POST") return refused(405, "method not allowed");
  const { pathname, search } = new URL(request.url);
  const [, profileId, path] = ROUTED_PATH.exec(pathname) ?? [];
  const route = profileId ? routeOf(profileId) : null;
  if (!route || !path || !API_PATHS[route.api].test(path)) return refused(404, "not a path of the model API");
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(mostMs)]);
    const answer = await fetch(upstreamUrl(route.upstream, path, search), { method: request.method, headers: headersFor(request, route), body: request.body, redirect: "manual", signal });
    return relayedAnswer(answer);
  } catch {
    return refused(502, "the model API could not be reached");
  }
}

export interface RunningSocket {
  stop(): Promise<void>;
}

/** How much of this computer a room's VM may hold through one socket: requests at once, and seconds one may go without a byte, 0 for no end. */
export interface SocketLimits {
  mostAtOnce: number;
  idleSeconds: number;
}

/** A room's agents' model requests: as many at once as a few agents with their subagents make, none silent past Bun's longest idle time. */
export const MODEL_SOCKET_LIMITS: SocketLimits = { mostAtOnce: 32, idleSeconds: 255 };

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

/** Serves a unix socket only this user of this computer reaches, made anew where an old one was left, within its limits. */
export async function serveOnSocket(socketPath: string, fetch: (request: Request) => Response | Promise<Response>, { mostAtOnce, idleSeconds }: SocketLimits): Promise<RunningSocket> {
  await rm(socketPath, { force: true });
  let atOnce = 0;
  const server = Bun.serve({
    unix: socketPath,
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
  await chmod(socketPath, 0o600);
  return {
    async stop() {
      await server.stop(true);
      await rm(socketPath, { force: true });
    },
  };
}

export const startModelProxy = (socketPath: string, relayPort: number, routeOf: (profileId: string) => ModelRoute | null, limits = MODEL_SOCKET_LIMITS, mostMs = MODEL_REQUEST_MOST_MS) =>
  serveOnSocket(socketPath, (request) => proxiedModelRequest(request, relayPort, routeOf, mostMs), limits);
