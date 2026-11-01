import { afterEach, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { freePorts } from "../e2e/free-ports.ts";

const listening: Server[] = [];
const listenOn = (port: number, host: string) =>
  new Promise<void>((resolve) => {
    const server = createServer();
    listening.push(server);
    server.listen({ port, host }, resolve);
  });
afterEach(() => listening.splice(0).forEach((server) => server.close()));

/** Just above the e2e hosts' range, so a unit run beside an e2e run takes none of their ports. */
const range = { lowest: 32_000, highest: 32_003 };

test("gives the first of as many free ports in a row as asked for", async () => {
  const first = await freePorts(4, range);
  expect(first).toBe(range.lowest);
  await Promise.all([0, 1, 2, 3].map((offset) => listenOn(first + offset, "0.0.0.0")));
});

test("passes over ports something listens on, on 127.0.0.1 or on every network", async () => {
  await listenOn(range.lowest + 1, "127.0.0.1");
  await expect(freePorts(4, range, 3)).rejects.toThrow("No 4 free ports in a row between 32000 and 32003");
  listening.splice(0).forEach((server) => server.close());

  await listenOn(range.lowest + 3, "0.0.0.0");
  await expect(freePorts(4, range, 3)).rejects.toThrow("No 4 free ports in a row");
  expect(await freePorts(3, range)).toBe(range.lowest);
});
