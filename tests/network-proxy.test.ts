import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askedIn, NETWORK_PROXY_LIMITS, startNetworkProxy, type NetworkProxy, type NetworkProxyLimits } from "../host/sandbox/network-proxy.ts";
import type { SandboxNetwork } from "../shared/sandbox.ts";
import { pastTaken } from "./past-taken.ts";
import { RUNS_SANDBOXES } from "./sandbox-computer.ts";

const scratch = mkdtempSync(join(tmpdir(), "np-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const opened: { proxies: NetworkProxy[]; servers: Server[]; sockets: Socket[] } = { proxies: [], servers: [], sockets: [] };
afterEach(async () => {
  opened.sockets.splice(0).forEach((socket) => socket.destroy());
  await Promise.all(opened.proxies.splice(0).map((proxy) => proxy.stop()));
  opened.servers.splice(0).forEach((server) => server.close());
});

async function eventually(holds: () => boolean | Promise<boolean>, withinMs = 4_000) {
  const until = Date.now() + withinMs;
  while (!(await holds())) {
    if (Date.now() > until) throw new Error("it never came to hold");
    await Bun.sleep(5);
  }
}

const HERE = "127.0.0.1";

/** A place of the test's that answers each connection as told, and what came to it. */
async function place(answer: (connection: Socket, received: () => string) => void = (connection) => void connection) {
  const connections: Socket[] = [];
  const received: string[] = [];
  const server = createServer((connection) => {
    const at = connections.push(connection) - 1;
    opened.sockets.push(connection);
    received[at] = "";
    connection.on("error", () => {});
    connection.on("data", (chunk) => {
      received[at] += chunk.toString("latin1");
      answer(connection, () => received[at]!);
    });
  });
  opened.servers.push(server);
  await new Promise<void>((listening) => server.listen(0, HERE, listening));
  return { port: (server.address() as AddressInfo).port, connections, received };
}

const echo = () => place((connection, received) => void connection.write(`got ${received()}`, "latin1"));

/** A sandbox's proxy, whose network, names and the addresses it may dial are the test's. */
async function proxyWith({
  network = "internet",
  names = {},
  may = () => true,
  limits = {},
}: { network?: SandboxNetwork; names?: Record<string, string[] | Promise<string[]>>; may?: (network: SandboxNetwork, address: string) => boolean; limits?: Partial<NetworkProxyLimits> } = {}) {
  const sandbox = { network };
  const lookedUp: string[] = [];
  const weighed: [SandboxNetwork, string][] = [];
  const socketPath = join(scratch, `${crypto.randomUUID().slice(0, 8)}.sock`);
  const proxy = await startNetworkProxy(socketPath, () => sandbox.network, { ...NETWORK_PROXY_LIMITS, ...limits }, {
    addressesOf: async (host) => {
      lookedUp.push(host);
      const addresses = names[host];
      if (!addresses) throw new Error(`no such name ${host}`);
      return addresses;
    },
    mayDial: (weighedFor, address) => {
      weighed.push([weighedFor, address]);
      return may(weighedFor, address);
    },
  });
  opened.proxies.push(proxy);
  const become = (changed: SandboxNetwork) => {
    sandbox.network = changed;
    proxy.networkChanged();
  };
  return { proxy, socketPath, sandbox, lookedUp, weighed, become };
}

/** A program in the VM, connected with the proxy, and all it heard from it. */
function program(socketPath: string) {
  const socket = connect(socketPath);
  opened.sockets.push(socket);
  const heard = { text: "", over: false };
  socket.on("error", () => {});
  socket.on("data", (chunk) => void (heard.text = pastTaken(heard.text + chunk.toString("latin1"))));
  socket.on("close", () => void (heard.over = true));
  return {
    socket,
    heard,
    say: (text: string) => void socket.write(text, "latin1"),
    hears: (text: string) => eventually(() => heard.text.includes(text)),
    isOver: () => eventually(() => heard.over),
  };
}

const connectTo = (host: string, port: number) => `CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`;

const ESTABLISHED = "HTTP/1.1 200 Connection established\r\n\r\n";

/** What the proxy answers to the request, until it ends the connection. */
async function answerTo(socketPath: string, request: string) {
  const { say, heard, isOver } = program(socketPath);
  say(request);
  await isOver();
  return heard.text;
}

const statusOf = (answer: string) => answer.split("\r\n")[0];
const reasonOf = (answer: string) => answer.split("\r\n\r\n")[1];

describe("a sandbox's way out", () => {
  test.skipIf(!RUNS_SANDBOXES)("is a socket of its owner's alone", async () => {
    const { socketPath } = await proxyWith({ names: { "a.test": [HERE] } });
    expect(statSync(socketPath).mode & 0o777).toBe(0o600);
  });

  test("is gone once it stops, and its connections with it", async () => {
    const { proxy, socketPath } = await proxyWith({ names: { "a.test": [HERE] } });
    const { port, connections } = await echo();
    const { say, hears, isOver } = program(socketPath);
    say(connectTo("a.test", port));
    await hears(ESTABLISHED);
    await proxy.stop();
    await isOver();
    await eventually(() => connections[0]!.destroyed);
    expect(existsSync(socketPath)).toBe(false);
  });

  test("tunnels bytes both ways, those that came with the request and while it looked the name up among them", async () => {
    const { port, received } = await echo();
    const addresses = Promise.withResolvers<string[]>();
    const { socketPath, lookedUp } = await proxyWith({ names: { "a.test": addresses.promise } });
    const { say, hears, heard } = program(socketPath);
    say(`${connectTo("a.test", port)}first `);
    await eventually(() => lookedUp.length === 1);
    say("second ");
    await Bun.sleep(30);
    expect(heard.text).toBe("");
    addresses.resolve([HERE]);
    await hears("got first second ");
    expect(heard.text.startsWith(ESTABLISHED)).toBe(true);
    say("\xff\x00third");
    await hears("got first second \xff\x00third");
    expect(received).toEqual(["first second \xff\x00third"]);
    expect(lookedUp).toEqual(["a.test"]);
  });

  test("passes on a request of an http address as its server reads it, without what is between the client and a proxy, and for that request alone", async () => {
    const { port, received } = await place((connection) => connection.end("HTTP/1.1 302 Found\r\nLocation: http://b.test/\r\nContent-Length: 0\r\n\r\n"));
    const { socketPath, lookedUp } = await proxyWith({ names: { "a.test": [HERE] } });
    const answer = await answerTo(
      socketPath,
      [`POST http://a.test:${port}/a/../b?q=%2F#part HTTP/1.1`, `Host: a.test:${port}`, "Proxy-Connection: keep-alive", "Proxy-Authorization: Basic eA==", "Connection: Upgrade", "Upgrade: h2c", "Keep-Alive: 5", "X-Kept: yes", "Content-Length: 4", "", "body"].join("\r\n"),
    );
    expect(received).toEqual([[`POST /a/../b?q=%2F HTTP/1.1`, `Host: a.test:${port}`, "X-Kept: yes", "Content-Length: 4", "Connection: close", "", "body"].join("\r\n")]);
    expect(answer).toStartWith("HTTP/1.1 302 Found\r\n");
    expect(lookedUp).toEqual(["a.test"]);
  });

  test("looks nothing up and connects with nothing while its network is closed, whatever it is asked", async () => {
    const { port, connections } = await echo();
    const { socketPath, lookedUp, weighed } = await proxyWith({ network: "closed", names: { "a.test": [HERE] } });
    for (const request of [connectTo("a.test", port), connectTo(HERE, port), `GET http://a.test:${port}/ HTTP/1.1\r\n\r\n`, "nonsense\r\n\r\n", "\r\n\r\n"]) {
      const answer = await answerTo(socketPath, request);
      expect(statusOf(answer)).toBe("HTTP/1.1 403 Forbidden");
      expect(reasonOf(answer)).toBe("This sandbox reaches only the agent's model and Mirador. Its owner decides what it reaches.\n");
    }
    expect([lookedUp, weighed, connections]).toEqual([[], [], []]);
  });

  test("connects with the addresses its network allows and no other, dialling no name, and an IPv4 one first", async () => {
    const { port, connections } = await echo();
    const { socketPath, weighed } = await proxyWith({
      names: { "mixed.test": ["2001:db8::9", "10.0.0.9", HERE] },
      may: (_, address) => address !== "10.0.0.9",
    });
    const { say, hears } = program(socketPath);
    say(connectTo("mixed.test", port));
    await hears(ESTABLISHED);
    expect(connections).toHaveLength(1);
    expect(weighed).toEqual([
      ["internet", "2001:db8::9"],
      ["internet", "10.0.0.9"],
      ["internet", HERE],
    ]);
  });

  test("looks an address up nowhere, and weighs it as any other", async () => {
    const { port, connections } = await echo();
    const { socketPath, lookedUp, sandbox } = await proxyWith({ may: (network) => network === "everything" });
    const refusedOne = await answerTo(socketPath, connectTo(HERE, port));
    expect(statusOf(refusedOne)).toBe("HTTP/1.1 403 Forbidden");
    expect(statusOf(await answerTo(socketPath, connectTo("[::1]", port)))).toBe("HTTP/1.1 403 Forbidden");
    sandbox.network = "everything";
    const { say, hears } = program(socketPath);
    say(connectTo(HERE, port));
    await hears(ESTABLISHED);
    expect(lookedUp).toEqual([]);
    expect(connections).toHaveLength(1);
  });

  test("answers the same to a name it may not reach as to one that is not there, so it tells nothing of its owner's networks", async () => {
    const { socketPath } = await proxyWith({ names: { "printer.lan": ["192.168.1.9"], "empty.test": [] }, may: () => false });
    const answers = await Promise.all(["printer.lan", "absent.lan", "empty.test", "192.168.1.9"].map((host) => answerTo(socketPath, connectTo(host, 80))));
    expect(new Set(answers).size).toBe(1);
    expect(statusOf(answers[0]!)).toBe("HTTP/1.1 403 Forbidden");
  });

  test("tries each address in turn, and says so where none answers", async () => {
    const { port } = await echo();
    const gone = await place();
    opened.servers.pop()!.close();
    const { socketPath } = await proxyWith({ names: { "half.test": ["127.0.0.2", HERE] }, limits: { connectWithinMs: 600 } });
    const { say, hears } = program(socketPath);
    say(connectTo("half.test", port));
    await hears(ESTABLISHED);
    expect(statusOf(await answerTo(socketPath, connectTo(HERE, gone.port)))).toBe("HTTP/1.1 502 Bad Gateway");
  });

  test("ends both sides once either does, after what it had sent", async () => {
    const { port, connections } = await place((connection, received) => void (received().endsWith("bye") && connection.end("last words")));
    const { socketPath } = await proxyWith({ names: { "a.test": [HERE] } });
    const leaving = program(socketPath);
    leaving.say(connectTo("a.test", port));
    await leaving.hears(ESTABLISHED);
    leaving.socket.destroy();
    await eventually(() => connections[0]!.destroyed);

    const left = program(socketPath);
    left.say(`${connectTo("a.test", port)}bye`);
    await left.isOver();
    expect(left.heard.text).toBe(`${ESTABLISHED}last words`);
  });

  test("ends a connection nothing came or went over for long", async () => {
    const { port } = await echo();
    const { socketPath } = await proxyWith({ names: { "a.test": [HERE] }, limits: { idleMs: 150 } });
    const { say, hears, isOver } = program(socketPath);
    say(connectTo("a.test", port));
    await hears(ESTABLISHED);
    await isOver();
  });

  test("says what it can't read, and that it is a proxy", async () => {
    const { socketPath, lookedUp } = await proxyWith();
    for (const request of ["GET / HTTP/1.1\r\nHost: a.test\r\n\r\n", "CONNECT a.test HTTP/1.1\r\n\r\n", "nonsense\r\n\r\n", "\x16\x03\x01\r\n\r\n"]) {
      const answer = await answerTo(socketPath, request);
      expect(statusOf(answer)).toBe("HTTP/1.1 400 Bad Request");
      expect(reasonOf(answer)).toBe("This is a web proxy: it takes CONNECT, and requests of http:// addresses.\n");
    }
    expect(lookedUp).toEqual([]);
  });
});

describe("a sandbox's network that changes", () => {
  const openTunnel = async (socketPath: string, port: number) => {
    const opening = program(socketPath);
    opening.say(connectTo("a.test", port));
    await opening.hears(ESTABLISHED);
    return opening;
  };

  test("takes effect on the next connection, and cuts those it allows no longer, and no others", async () => {
    const { port, connections } = await echo();
    const { socketPath, become } = await proxyWith({ names: { "a.test": [HERE] } });
    const underInternet = await openTunnel(socketPath, port);
    become("everything");
    const underEverything = await openTunnel(socketPath, port);
    become("internet");
    await underEverything.isOver();
    await eventually(() => connections[1]!.destroyed);
    underInternet.say("still here");
    await underInternet.hears("got still here");
    become("closed");
    await underInternet.isOver();
    await eventually(() => connections[0]!.destroyed);
    expect(statusOf(await answerTo(socketPath, connectTo("a.test", port)))).toBe("HTTP/1.1 403 Forbidden");
    expect(connections).toHaveLength(2);
  });

  test("cuts those still being looked up, which connect with nothing then", async () => {
    const { port, connections } = await echo();
    const addresses = Promise.withResolvers<string[]>();
    const { socketPath, lookedUp, weighed, become } = await proxyWith({ names: { "a.test": addresses.promise } });
    const { say, isOver, heard } = program(socketPath);
    say(connectTo("a.test", port));
    await eventually(() => lookedUp.length === 1);
    become("closed");
    await isOver();
    addresses.resolve([HERE]);
    await Bun.sleep(30);
    expect([heard.text, weighed, connections]).toEqual(["", [], []]);
  });

  test("leaves one that came before it with nothing, though nobody told of the change", async () => {
    const { port, received } = await echo();
    const addresses = Promise.withResolvers<string[]>();
    const { socketPath, sandbox, lookedUp } = await proxyWith({ names: { "a.test": addresses.promise } });
    const { say, isOver, heard } = program(socketPath);
    say(`${connectTo("a.test", port)}secret`);
    await eventually(() => lookedUp.length === 1);
    sandbox.network = "closed";
    addresses.resolve([HERE]);
    await isOver();
    expect(heard.text).toBe("");
    expect(received.join("")).toBe("");
  });
});

describe("what a sandbox may hold of this computer through its way out", () => {
  test("is so many connections at once, the rest told so or ended, until one ends", async () => {
    const { port } = await echo();
    const { socketPath } = await proxyWith({ names: { "a.test": [HERE] }, limits: { mostAtOnce: 2 } });
    const first = program(socketPath);
    const second = program(socketPath);
    for (const each of [first, second]) {
      each.say(connectTo("a.test", port));
      await each.hears(ESTABLISHED);
    }
    expect(statusOf(await answerTo(socketPath, connectTo("a.test", port)))).toBe("HTTP/1.1 503 Service Unavailable");
    first.socket.destroy();
    await first.isOver();
    await eventually(async () => {
      const next = program(socketPath);
      next.say(connectTo("a.test", port));
      await eventually(() => next.heard.text !== "");
      return next.heard.text.startsWith(ESTABLISHED);
    });
  });

  test("is no head of a request too long or too slow, whether its network is closed or open", async () => {
    for (const network of ["closed", "everything"] as const) {
      const { socketPath, lookedUp } = await proxyWith({ network, names: { "a.test": [HERE] }, limits: { mostHeadBytes: 200, headWithinMs: 150 } });
      expect(await answerTo(socketPath, "x".repeat(300))).toBe("");
      expect(await answerTo(socketPath, `CONNECT a.test:80 HTTP/1.1\r\nX: ${"x".repeat(300)}\r\n\r\n`)).toBe("");
      const slow = program(socketPath);
      slow.say("CONNECT a.test:80 HTTP/1.1\r\n");
      await slow.isOver();
      expect(slow.heard.text).toBe("");
      const silent = program(socketPath);
      await silent.isOver();
      expect(lookedUp).toEqual([]);
    }
  });

  test("is no lookup or connection for longer than it may take", async () => {
    const { socketPath } = await proxyWith({ names: { "never.test": new Promise<string[]>(() => {}) }, limits: { lookUpWithinMs: 50 } });
    expect(statusOf(await answerTo(socketPath, connectTo("never.test", 443)))).toBe("HTTP/1.1 403 Forbidden");
  });

  test("is no memory for what nobody reads: a fast server waits for a slow program", async () => {
    const chunk = Buffer.alloc(1024 * 1024, 97);
    let sent = 0;
    const { port } = await place((connection) => {
      const more = () => {
        while (sent < 64 && !connection.destroyed) {
          sent += 1;
          if (!connection.write(chunk)) return void connection.once("drain", more);
        }
      };
      more();
    });
    const { socketPath } = await proxyWith({ names: { "a.test": [HERE] } });
    const slow = program(socketPath);
    slow.say(connectTo("a.test", port));
    await slow.hears(ESTABLISHED);
    slow.socket.pause();
    slow.say("go");
    await eventually(() => sent > 0);
    await Bun.sleep(300);
    const sentUnread = sent;
    expect(sentUnread).toBeLessThan(64);
    slow.socket.resume();
    await eventually(() => slow.heard.text.length === ESTABLISHED.length + 64 * chunk.length, 10_000);
  }, 20_000);
});

describe("what a proxy's request asks for", () => {
  const tunnel = (host: string, port: number) => ({ host, port, first: "", isTunnel: true });

  test("is a tunnel to a name or an address with a port", () => {
    expect(askedIn("CONNECT a.test:443 HTTP/1.1")).toEqual(tunnel("a.test", 443));
    expect(askedIn("CONNECT 1.1.1.1:443 HTTP/1.0\r\nX: y")).toEqual(tunnel("1.1.1.1", 443));
    expect(askedIn("CONNECT [2606:4700::1111]:8443 HTTP/1.1")).toEqual(tunnel("2606:4700::1111", 8443));
    expect(askedIn("CONNECT under_score.test.:65535 HTTP/1.1")).toEqual(tunnel("under_score.test.", 65535));
  });

  test("is nothing that can be read where it names no place, or one another way", () => {
    for (const target of ["a.test", "a.test:", "a.test:0", "a.test:65536", "a.test:-1", "a.test:4x", ":443", "user@a.test:443", "a.test:443/path", "[fe80::1%en0]:443", "[::1:443", "a test:443", "http://a.test:443", "a.test:443\tx"])
      expect([target, askedIn(`CONNECT ${target} HTTP/1.1`)]).toEqual([target, null]);
    for (const line of ["", "CONNECT", "CONNECT a.test:443", "CONNECT a.test:443 HTTP/2", "connect a.test:443 HTTP/1.1", "GET / HTTP/1.1", "GET https://a.test/ HTTP/1.1", "GET ftp://a.test/ HTTP/1.1", "GET http:/// HTTP/1.1", "GET http://user:pw@a.test/ HTTP/1.1", "GET http://a.test:99999/ HTTP/1.1"])
      expect([line, askedIn(line)]).toEqual([line, null]);
  });

  test("is an http address's server at its port, or at 80, and its path with its query", () => {
    const pathOf = (target: string) => askedIn(`GET ${target} HTTP/1.1`);
    expect(pathOf("http://a.test")).toEqual({ host: "a.test", port: 80, first: "GET / HTTP/1.1\r\nConnection: close\r\n\r\n", isTunnel: false });
    expect(pathOf("HTTP://a.test:8080/x?y=/z")).toEqual({ host: "a.test", port: 8080, first: "GET /x?y=/z HTTP/1.1\r\nConnection: close\r\n\r\n", isTunnel: false });
    expect(pathOf("http://[::1]?q")).toEqual({ host: "::1", port: 80, first: "GET /?q HTTP/1.1\r\nConnection: close\r\n\r\n", isTunnel: false });
  });
});
