import { chmod, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";

export interface RunningSocket {
  stop(): Promise<void>;
}

/** Connections past the most at once that are told so before they end; any more end without a word. */
const MOST_TURNED_AWAY_AT_ONCE = 64;

/**
 * The byte said on every connection before anything else, for the VM's relays to hear that it was taken: in-vm/relays.mjs
 * keeps it to itself. Apple's container 0.12 now and then loses the first thing a VM says on a connection that a program
 * just started there opens, unless this computer has spoken first.
 */
export const TAKEN = "\x06";

/** What is done with a connection of the VM's: one of the most it may have at once, or one past them. */
export interface ConnectionsTaken {
  mostAtOnce: number;
  /** Whether a client that has said all it will is still heard out, as a web server does. */
  allowHalfOpen: boolean;
  take(client: Socket): void;
  turnAway(client: Socket): void;
}

const refusal = (status: string, why: string) =>
  `HTTP/1.1 ${status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(why) + 1}\r\nConnection: close\r\n\r\n${why}\n`;

/** Tells an HTTP client why it is refused and ends its connection, however little of that it reads. */
export function refuse(client: Socket, status: string, why: string, goneWithinMs: number) {
  client.end(refusal(status, why));
  client.resume();
  setTimeout(() => client.destroy(), goneWithinMs).unref();
}

/** Bytes both ways until either side ends, or nothing has gone over for so long, 0 for no end; what the upstream had sent still goes out. */
export function passBothWays(client: Socket, upstream: Socket, idleMs: number) {
  const ended = () => {
    client.destroy();
    upstream.destroy();
  };
  [client, upstream].forEach((side) => {
    side.setTimeout(idleMs, ended);
    side.on("error", ended);
  });
  upstream.on("close", () => client.end());
  client.on("close", () => upstream.destroy());
  upstream.pipe(client);
  client.pipe(upstream);
}

/** A unix socket only this user of this computer reaches, made anew where an old one was left, holding no more connections of a VM's than it may have. */
export async function listenOnSocket(socketPath: string, { mostAtOnce, allowHalfOpen, take, turnAway }: ConnectionsTaken): Promise<RunningSocket> {
  await rm(socketPath, { force: true });
  const clients = new Set<Socket>();
  const server = createServer({ allowHalfOpen }, (client) => {
    client.on("error", () => client.destroy());
    clients.add(client);
    client.write(TAKEN);
    client.on("close", () => clients.delete(client));
    if (clients.size > MOST_TURNED_AWAY_AT_ONCE + mostAtOnce) return void client.destroy();
    if (clients.size > mostAtOnce) return turnAway(client);
    take(client);
  });
  const listening = Promise.withResolvers<void>();
  server.once("error", listening.reject);
  server.listen(socketPath, listening.resolve);
  await listening.promise;
  await chmod(socketPath, 0o600);
  return {
    async stop() {
      server.close();
      clients.forEach((client) => client.destroy());
      await rm(socketPath, { force: true });
    },
  };
}
