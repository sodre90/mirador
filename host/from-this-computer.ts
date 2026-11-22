import { CANVAS_ASSETS_ORIGIN_HEADER } from "../shared/protocol.ts";
import { isLoopback } from "./hub.ts";

/** What another computer is told when it brings the host's own token, in a sign-in link or a command. */
export const BROWSER_TOKEN_ONLY_HERE =
  "This sign-in link works only on the computer Mirador runs on. To use Mirador on this device, add it with an invite from Settings → Devices on that computer.";

const PROXY_HEADERS = new Set(["forwarded", "via", "x-real-ip", CANVAS_ASSETS_ORIGIN_HEADER]);
const PROXY_HEADER_PREFIXES = ["x-forwarded-", "tailscale-"];

/**
 * `tailscale serve` sets X-Forwarded-For, -Host and -Proto on every request it passes on, over whatever its client sent,
 * and another Mirador's relay sets the canvas assets origin, so a request through either always carries one of these.
 */
const passedOnByAProxy = (headers: Headers) =>
  [...headers.keys()].some((name) => PROXY_HEADERS.has(name) || PROXY_HEADER_PREFIXES.some((prefix) => name.startsWith(prefix)));

/** The names a browser on this computer reaches a listener on 127.0.0.1 by. */
const loopbackHosts = (port: number) => [`127.0.0.1:${port}`, `localhost:${port}`];

/**
 * Whether a request to a listener on 127.0.0.1 at `port` came from a browser or process on this computer itself. A
 * proxy here, such as `tailscale serve`, also connects from a loopback address and passes on whatever Host its client
 * sent, so the request must name the listener by a loopback name and carry no sign of having been passed on.
 */
export const fromThisComputer = (request: Request, peerAddress: string | undefined, port: number) =>
  isLoopback(peerAddress ?? "") && loopbackHosts(port).includes(request.headers.get("host") ?? "") && !passedOnByAProxy(request.headers);
