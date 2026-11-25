import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { connect, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listenOnSocket, refuse, TAKEN } from "../host/sandbox/vm-connections.ts";

const scratch = mkdtempSync(join(tmpdir(), "vm-relays-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const RELAYS = join(import.meta.dir, "../host/sandbox/in-vm/relays.mjs");

const freePort = () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const { port } = server;
  server.stop(true);
  return port!;
};

test("a room's VM relays end once Mirador's sockets stop answering, which stops the VM, and not while they answer", async () => {
  const socket = join(scratch, "model.sock");
  const mirador = createServer((connection) => connection.end(TAKEN)).listen(socket);
  const relays = Bun.spawn([process.execPath, RELAYS, `${freePort()}=${socket}`], {
    env: { ...process.env, RELAYS_LOOK_EVERY_MS: "50", RELAYS_GIVE_UP_AFTER_MS: "300" },
    stdout: "pipe",
  });
  try {
    await Bun.sleep(600);
    expect(relays.exitCode).toBeNull();

    await new Promise((closed) => mirador.close(closed));
    const exitCode = await Promise.race([relays.exited, Bun.sleep(3_000).then(() => "still running")]);
    expect(exitCode).toBe(1);
    expect(await new Response(relays.stdout).text()).toContain("Mirador's sockets stopped answering");
  } finally {
    relays.kill();
  }
});

describe("what a program in a room's VM says goes to Mirador once Mirador took the connection", () => {
  const cleanUps: (() => unknown)[] = [];
  afterAll(() => Promise.all(cleanUps.map((cleanUp) => cleanUp())));

  async function relayTo(socket: string) {
    const port = freePort();
    const relays = Bun.spawn([process.execPath, RELAYS, `${port}=${socket}`], { stdout: "pipe" });
    cleanUps.push(() => relays.kill());
    for await (const said of relays.stdout) if (Buffer.from(said).includes("relays ready")) break;
    return port;
  }

  /** A server on a socket as Apple's container stands before Mirador's: what it does with each connection, in the order they come, the last of it with all others. */
  function forwarder(name: string, ...each: ((connection: Socket) => unknown)[]) {
    const socket = join(scratch, `${name}.sock`);
    const taken: Socket[] = [];
    const server = createServer((connection) => {
      connection.on("error", () => {});
      taken.push(connection);
      each[Math.min(taken.length, each.length) - 1]!(connection);
    }).listen(socket);
    cleanUps.push(() => (taken.forEach((connection) => connection.destroy()), server.close()));
    return { socket, taken };
  }

  /** All the program hears to what it says, until its connection ends. */
  function heardBy(port: number, says: string) {
    const program = connect(port, "127.0.0.1");
    const heard = Promise.withResolvers<string>();
    let text = "";
    program.on("data", (chunk) => (text += chunk.toString()));
    program.on("error", () => {});
    program.on("close", () => heard.resolve(text));
    program.write(says);
    return heard.promise;
  }

  const hangsUp = (connection: Socket) => connection.destroy();
  const answersInOnePiece = (connection: Socket) => connection.once("data", (asked) => connection.end(`heard ${asked}`));
  const takesAndAnswers = (connection: Socket) => {
    connection.write(TAKEN);
    answersInOnePiece(connection);
  };

  test("one hung up before Mirador hears of it is made again, and the program hears nothing of it, nor the byte that says it was taken", async () => {
    const { socket, taken } = forwarder("hangs-up", hangsUp, hangsUp, takesAndAnswers);
    expect(await heardBy(await relayTo(socket), "hello")).toBe("heard hello");
    expect(taken).toHaveLength(3);
  });

  test("nothing is said on one before it is taken, and what comes with that byte reaches the program", async () => {
    const heardBefore: string[] = [];
    const { socket } = forwarder("takes-late", (connection) => {
      const early = (said: Buffer) => heardBefore.push(said.toString());
      connection.on("data", early);
      setTimeout(() => {
        connection.off("data", early);
        answersInOnePiece(connection);
        connection.write(`${TAKEN}welcome `);
      }, 150);
    });
    expect(await heardBy(await relayTo(socket), "hello")).toBe("welcome heard hello");
    expect(heardBefore).toEqual([]);
  });

  test("where none is taken, the program's connection ends, and the next one is tried for anew", async () => {
    const { socket, taken } = forwarder("never-at-first", hangsUp, hangsUp, hangsUp, hangsUp, hangsUp, takesAndAnswers);
    const port = await relayTo(socket);
    expect(await heardBy(port, "hello")).toBe("");
    expect(taken).toHaveLength(5);
    expect(await heardBy(port, "again")).toBe("heard again");
  });

  test("one that ends as it is taken isn't made again", async () => {
    const { socket, taken } = forwarder("takes-and-ends", (connection) => connection.end(TAKEN));
    expect(await heardBy(await relayTo(socket), "hello")).toBe("");
    expect(taken).toHaveLength(1);
  });

  test("each connection of Mirador's sockets is said to be taken, those past the most it holds too", async () => {
    const socket = join(scratch, "mirador.sock");
    const listening = await listenOnSocket(socket, { mostAtOnce: 1, allowHalfOpen: false, take: answersInOnePiece, turnAway: (client) => refuse(client, "503 Service Unavailable", "full", 1_000) });
    cleanUps.push(() => listening.stop());
    const port = await relayTo(socket);
    const held = connect(port, "127.0.0.1");
    cleanUps.push(() => held.destroy());
    const untilHeard = async (text: string) => {
      while (!(await heardBy(port, "hello")).startsWith(text)) await Bun.sleep(20);
    };
    await untilHeard("HTTP/1.1 503 Service Unavailable\r\n");
    held.destroy();
    await untilHeard("heard hello");
  });
});
