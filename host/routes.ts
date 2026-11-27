import type { SocketData } from "./hub.ts";

type Method = "GET" | "POST" | "DELETE";

/** The methods a route answers, or any, for a route Bun hands every method to one handler of. */
export type RouteMethods = readonly Method[] | "any";

/** A table of handlers that serves exactly these routes, each with exactly its methods. */
export type RouteHandlers<Routes extends Record<string, RouteMethods>> = {
  [Path in keyof Routes]: Routes[Path] extends readonly Method[] ? { [Each in Routes[Path][number]]: unknown } : unknown;
};

/** All the network listener serves: what pages of other devices use. */
export const DEVICE_ROUTES = {
  "/": "any",
  "/join": ["POST"],
  "/join-challenges": ["POST"],
  "/join-requests": ["POST"],
  "/join-requests/:id/reveal": ["POST"],
  "/join-requests/:id/poll": ["POST"],
  "/conversations/:conversationId/images": ["POST"],
  "/conversations/:conversationId/files": ["POST"],
  "/conversations/:conversationId/speech": ["POST"],
  "/conversations/:conversationId/reply-summary": ["POST"],
  "/conversations/:conversationId/spoken-sentence": ["POST"],
  "/conversations/:conversationId/images/:imageId": ["GET"],
  "/conversations/:conversationId/events/:seq/images/:index": ["GET"],
  "/conversations/:conversationId/local-image": ["GET"],
  "/plugin-screenshot": ["GET"],
  "/plugin-picture": ["GET"],
  "/workspaces/:workspaceId/apps/:app/file": ["GET"],
  "/workspaces/:workspaceId/apps/:app/media": ["POST"],
  "/workspaces/:workspaceId/apps/:app/files": ["GET"],
  "/workspaces/:workspaceId/apps/:app/open": ["POST"],
  "/workspaces/:workspaceId/apps/:app/git/refs": ["GET"],
  "/workspaces/:workspaceId/apps/:app/git/file": ["GET"],
  "/workspaces/:workspaceId/apps/:app/git/changed": ["GET"],
  "/mirador-ca.pem": "any",
  "/mirador-here": "any",
  "/tunnel": ["POST"],
} as const satisfies Record<string, RouteMethods>;

/** Only this machine's own browser, agents and scripts sign in with these tokens, so they are served on 127.0.0.1 alone. */
export const THIS_MACHINE_ROUTES = {
  "/auth": "any",
  "/mcp/:conversationId": "any",
  "/sessions/:sessionId/messages": ["POST"],
  "/sessions/:sessionId/job-waits": ["POST"],
  "/devices": ["GET"],
  "/settings-import/plan": ["POST"],
  "/settings-import": ["POST"],
  "/settings-import/plugins": ["POST"],
  "/settings-import/plugins/:offerId": ["POST", "DELETE"],
} as const satisfies Record<string, RouteMethods>;

type Route = keyof typeof DEVICE_ROUTES | keyof typeof THIS_MACHINE_ROUTES;

/** A person other than the owner reaches the page itself over HTTP, what anyone reaches before signing in, and read-only app routes checked per room; every other route is the owner's. */
export const OPEN_TO_PEOPLE: ReadonlySet<string> = new Set<Route>([
  "/",
  "/join",
  "/join-challenges",
  "/join-requests",
  "/join-requests/:id/reveal",
  "/join-requests/:id/poll",
  "/mirador-ca.pem",
  "/mirador-here",
  "/auth",
  "/workspaces/:workspaceId/apps/:app/file",
  "/workspaces/:workspaceId/apps/:app/media",
  "/workspaces/:workspaceId/apps/:app/files",
  "/workspaces/:workspaceId/apps/:app/git/refs",
  "/workspaces/:workspaceId/apps/:app/git/file",
  "/workspaces/:workspaceId/apps/:app/git/changed",
]);

/** A person other than the owner opens the page's own socket; every other socket is the owner's. */
export const SOCKETS_OPEN_TO_PEOPLE = new Set<SocketData["role"]>(["page"]);
