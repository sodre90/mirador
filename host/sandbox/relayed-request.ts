/**
 * Whether a request reached a socket of a room's VM as one of its relays passes it on: addressed by path to the relay's
 * own 127.0.0.1 port, never CONNECT or a full address of another host, which a proxy would go on to.
 */
export function cameThroughRelay(request: Request, port: number): boolean {
  if (request.method === "CONNECT") return false;
  const host = request.headers.get("host");
  const relayHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  return host !== null && relayHosts.includes(host) && relayHosts.includes(new URL(request.url).host);
}
