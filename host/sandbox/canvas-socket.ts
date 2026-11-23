import { sameSecret } from "../sign-in.ts";
import { serveOnSocket, type SocketLimits } from "./model-proxy.ts";
import { cameThroughRelay } from "./relayed-request.ts";

/** What a sandbox's canvas socket asks of the host: whether a conversation is the sandbox owner's, its canvas token, and its canvas server. */
export interface SandboxCanvas {
  belongs(conversationId: string): boolean;
  tokenOf(conversationId: string): string;
  handle(conversationId: string, request: Request): Response | Promise<Response>;
}

const MCP_PATH = /^\/mcp\/([A-Za-z0-9-]{1,64})$/;

const refused = (status: number, why: string) => new Response(`${why}\n`, { status });

/**
 * One request of a sandbox's VM to its canvas: only a conversation's canvas server, with that conversation's token, never a
 * browser's request, a WebSocket or anything else the app serves.
 */
export function canvasRequest(request: Request, relayPort: number, canvas: SandboxCanvas): Response | Promise<Response> {
  if (!cameThroughRelay(request, relayPort) || request.headers.has("origin") || request.headers.has("upgrade")) return refused(403, "forbidden");
  if (!["GET", "POST", "DELETE"].includes(request.method)) return refused(405, "method not allowed");
  const conversationId = MCP_PATH.exec(new URL(request.url).pathname)?.[1];
  if (!conversationId || !canvas.belongs(conversationId)) return refused(404, "not found");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!sameSecret(bearer, canvas.tokenOf(conversationId))) return refused(401, "unauthorized");
  return canvas.handle(conversationId, request);
}

/** A sandbox's canvas requests: a canvas server's stream per conversation, and its calls, one of which may wait on the owner for long. */
export const CANVAS_SOCKET_LIMITS: SocketLimits = { mostAtOnce: 64, idleSeconds: 0 };

export const startCanvasSocket = (socketPath: string, relayPort: number, canvas: SandboxCanvas, limits = CANVAS_SOCKET_LIMITS) =>
  serveOnSocket(socketPath, (request) => canvasRequest(request, relayPort, canvas), limits);
