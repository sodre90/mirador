import { randomInt } from "node:crypto";
import { createServer } from "node:net";

/**
 * Clear of the owner's own Mirador (4600 and its machine relays up to 4719), Android emulators (5554 up) and
 * mirador-mobile's e2e hosts (5800 up), and below the ports the system hands out on its own (32768 up on Linux, 49152
 * up on macOS), which the specs' fake servers take.
 */
export const E2E_PORT_RANGE = { lowest: 20_000, highest: 31_999 };

const canListen = (port: number, host: string) =>
  new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host }, () => server.close(() => resolve(true)));
  });

/** A host listens on 127.0.0.1, and on every network for the ports it serves the network on. */
const isFree = async (port: number) => (await canListen(port, "127.0.0.1")) && (await canListen(port, "0.0.0.0"));

const consecutive = (first: number, count: number) => Array.from({ length: count }, (_, offset) => first + offset);

/**
 * The first of `count` consecutive ports that nothing listens on, from a random place in the range, so that hosts
 * starting at the same moment, in this run or another, rarely even try the same ones.
 */
export async function freePorts(count: number, { lowest, highest } = E2E_PORT_RANGE, attempts = 50): Promise<number> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const first = randomInt(lowest, highest - count + 2);
    const free = await Promise.all(consecutive(first, count).map(isFree));
    if (free.every(Boolean)) return first;
  }
  throw new Error(`No ${count} free ports in a row between ${lowest} and ${highest}`);
}
