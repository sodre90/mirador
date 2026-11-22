import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePorts } from "../e2e/free-ports.ts";
import { SignInCodes } from "../host/sign-in-codes.ts";
import { Store } from "../host/store.ts";
import { BROWSER_TOKEN_ONLY_HERE, fromThisComputer } from "../host/from-this-computer.ts";
import { TOKEN_COOKIE } from "../shared/protocol.ts";

const PORT = 4600;
const requestWith = (headers: Record<string, string>) => new Request(`http://127.0.0.1:${PORT}/`, { headers });
/** What `tailscale serve` passed on to 127.0.0.1 when a tailnet client asked it with `Host: 127.0.0.1:4600`, seen on 2026-11-22 with Tailscale 1.102.3. */
const throughTailscaleServe = {
  host: `127.0.0.1:${PORT}`,
  "x-forwarded-for": "100.101.5.7",
  "x-forwarded-host": `127.0.0.1:${PORT}`,
  "x-forwarded-proto": "https",
  "tailscale-user-login": "someone@github",
};

describe("a request from this computer itself", () => {
  test("names the listener by a loopback name, from a loopback address", () => {
    expect(fromThisComputer(requestWith({ host: `127.0.0.1:${PORT}` }), "127.0.0.1", PORT)).toBe(true);
    expect(fromThisComputer(requestWith({ host: `localhost:${PORT}` }), "::ffff:127.0.0.1", PORT)).toBe(true);
    expect(fromThisComputer(requestWith({ host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, cookie: `${TOKEN_COOKIE}=x` }), "::1", PORT)).toBe(true);
  });

  test("is not one `tailscale serve` passed on, though the Host it passes on is the one its client chose, and its other headers may be missing or empty", () => {
    expect(fromThisComputer(requestWith(throughTailscaleServe), "127.0.0.1", PORT)).toBe(false);
    expect(fromThisComputer(requestWith({ host: `127.0.0.1:${PORT}`, "x-forwarded-for": "100.101.5.7" }), "127.0.0.1", PORT)).toBe(false);
    expect(fromThisComputer(requestWith({ host: `127.0.0.1:${PORT}`, "x-forwarded-host": "" }), "127.0.0.1", PORT)).toBe(false);
    expect(fromThisComputer(requestWith({ host: `127.0.0.1:${PORT}`, "tailscale-headers-info": "https://tailscale.com/s/serve-headers" }), "127.0.0.1", PORT)).toBe(false);
    expect(fromThisComputer(requestWith({ ...throughTailscaleServe, host: "box.example.ts.net" }), "127.0.0.1", PORT)).toBe(false);
  });

  test("is not one another proxy or another Mirador's relay passed on", () => {
    expect(fromThisComputer(requestWith({ host: `127.0.0.1:${PORT}`, forwarded: "for=192.0.2.60;proto=https" }), "127.0.0.1", PORT)).toBe(false);
    expect(fromThisComputer(requestWith({ host: `127.0.0.1:${PORT}`, via: "1.1 proxy" }), "127.0.0.1", PORT)).toBe(false);
    expect(fromThisComputer(requestWith({ host: `127.0.0.1:${PORT}`, "x-real-ip": "192.168.1.20" }), "127.0.0.1", PORT)).toBe(false);
    expect(fromThisComputer(requestWith({ host: `127.0.0.1:${PORT}`, "mirador-canvas-assets-origin": "http://127.0.0.1:4621" }), "127.0.0.1", PORT)).toBe(false);
  });

  test("is not one that names the host otherwise, comes from another address, or reached a listener on no address", () => {
    expect(fromThisComputer(requestWith({ host: "box.example.ts.net" }), "127.0.0.1", PORT)).toBe(false);
    expect(fromThisComputer(requestWith({ host: `127.0.0.1:${PORT + 2}` }), "127.0.0.1", PORT)).toBe(false);
    expect(fromThisComputer(requestWith({ host: "127.0.0.1" }), "127.0.0.1", PORT)).toBe(false);
    expect(fromThisComputer(requestWith({ host: `192.168.1.5:${PORT}` }), "192.168.1.20", PORT)).toBe(false);
    expect(fromThisComputer(requestWith({ host: `127.0.0.1:${PORT}` }), "192.168.1.20", PORT)).toBe(false);
    expect(fromThisComputer(requestWith({ host: `127.0.0.1:${PORT}` }), undefined, PORT)).toBe(false);
  });
});

/**
 * A real host, asked over a raw connection so each request carries exactly the Host and headers it is written with, as
 * `tailscale serve`, a forward or a relay passes them on.
 */
describe("the host's own token", () => {
  const repoRoot = join(import.meta.dirname, "..");
  const root = mkdtempSync(join(tmpdir(), "mirador-this-computer-"));
  const dataDir = join(root, "data");
  const PUBLIC_HOST = "box.example.ts.net";
  let host: ChildProcess;
  let hostOutput = "";
  let port = 0;
  let browserToken = "";

  const hostEnvironment = () => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("MIRADOR_"))),
    CLAUDE_CONFIG_DIR: join(root, "claude-config"),
    MIRADOR_PORT: String(port),
    MIRADOR_DATA_DIR: dataDir,
    MIRADOR_NETWORK: "off",
    MIRADOR_TAILSCALE: join(root, "no-tailscale-on-this-machine"),
    MIRADOR_NOTIFIER_DIR: join(root, "notifier"),
    MIRADOR_TEST_SKIP_USER_SETTINGS: "1",
    MIRADOR_STATUSLINE: "off",
    MIRADOR_NEWER_VERSION_CHECK: "off",
    MIRADOR_PLUGIN_UPDATE_CHECK: "off",
    MIRADOR_SOURCE_WATCH: "off",
    MIRADOR_PLUGIN_CATALOG: "off",
    MIRADOR_PI_RELEASE_URL: "off",
    MIRADOR_DEFAULT_PLUGINS: "off",
    MIRADOR_PUSH_RELAY: "off",
    MIRADOR_P2P: "off",
    MIRADOR_PUBLIC_ORIGIN: `https://${PUBLIC_HOST}`,
    MIRADOR_PUBLIC_CANVAS_ORIGIN: `https://${PUBLIC_HOST}:8443`,
  });

  beforeAll(async () => {
    port = await freePorts(4);
    host = spawn("bun", ["host/main.ts"], { cwd: repoRoot, env: hostEnvironment(), stdio: ["ignore", "pipe", "pipe"] });
    const capture = (chunk: Buffer) => void (hostOutput += chunk);
    host.stdout!.on("data", capture);
    host.stderr!.on("data", capture);
    const deadline = Date.now() + 20_000;
    while (!hostOutput.includes("Mirador is running")) {
      if (Date.now() > deadline || host.exitCode !== null) throw new Error(`The host did not start:\n${hostOutput.split("\n").filter((line) => !line.includes("auth?")).join("\n")}`);
      await Bun.sleep(100);
    }
    browserToken = readFileSync(join(dataDir, "browser-token"), "utf8").trim();
  }, 30_000);

  afterAll(async () => {
    if (host && host.exitCode === null) {
      const exited = new Promise((resolve) => host.once("exit", resolve));
      host.kill("SIGTERM");
      await Promise.race([exited, Bun.sleep(8_000)]);
      if (host.exitCode === null) host.kill("SIGKILL");
    }
    rmSync(root, { recursive: true, force: true });
  }, 20_000);

  /** The answer once its whole body came, as long as its Content-Length says; null while more is to come. */
  function answerIn(received: Buffer) {
    const headEnd = received.indexOf("\r\n\r\n");
    if (headEnd === -1) return null;
    const head = received.subarray(0, headEnd).toString();
    const length = Number(/^content-length: *(\d+)$/im.exec(head)?.[1] ?? 0);
    const body = received.subarray(headEnd + 4);
    return body.length < length ? null : { status: Number(head.split(" ")[1]), body: body.subarray(0, length).toString() };
  }

  /** Answers as soon as the host's answer is whole, whether it keeps the connection open or turns it into a socket. */
  function rawGet(path: string, headers: Record<string, string>) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      let received = Buffer.alloc(0);
      const socket = connect(port, "127.0.0.1", () => socket.write([`GET ${path} HTTP/1.1`, ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`), "", ""].join("\r\n")));
      socket.on("data", (chunk: Buffer) => {
        received = Buffer.concat([received, chunk]);
        const answer = answerIn(received);
        if (!answer) return;
        socket.destroy();
        resolve(answer);
      });
      socket.on("error", reject);
    });
  }

  const thisComputer = () => ({ Host: `127.0.0.1:${port}` });
  const forwardedShapes: Record<string, () => Record<string, string>> = {
    "tailscale serve, passing on a Host its client set to this computer's": () => ({
      Host: `127.0.0.1:${port}`,
      "X-Forwarded-For": "100.101.5.7",
      "X-Forwarded-Host": `127.0.0.1:${port}`,
      "X-Forwarded-Proto": "https",
      "Tailscale-User-Login": "someone@github",
    }),
    "tailscale serve at this computer's tailnet name": () => ({ Host: PUBLIC_HOST, "X-Forwarded-For": "100.101.5.7", "X-Forwarded-Host": PUBLIC_HOST, "X-Forwarded-Proto": "https" }),
    "a forward that adds nothing, at the public name": () => ({ Host: PUBLIC_HOST }),
    "another Mirador's relay": () => ({ Host: `127.0.0.1:${port}`, "mirador-canvas-assets-origin": "http://127.0.0.1:4621" }),
  };
  const originFor = (shape: Record<string, string>) => (shape.Host === PUBLIC_HOST ? `https://${PUBLIC_HOST}` : `http://${shape.Host}`);

  const socketWithCookie = (shape: Record<string, string>) =>
    rawGet("/ws", {
      ...shape,
      Origin: originFor(shape),
      Cookie: `${TOKEN_COOKIE}=${browserToken}`,
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version": "13",
    });
  const linkWithToken = (shape: Record<string, string>) => rawGet(`/auth?token=${browserToken}`, { ...shape });
  const linkWithCode = (shape: Record<string, string>, code: string) => rawGet(`/auth?code=${code}`, { ...shape });
  const devicesWithBearer = (shape: Record<string, string>) => rawGet("/devices", { ...shape, Authorization: `Bearer ${browserToken}` });

  function mintedCode() {
    const store = new Store(join(dataDir, "state.sqlite"));
    const code = new SignInCodes(store).mint();
    store.close();
    return code;
  }

  test("signs in from this computer itself, as a cookie, in a link, through a one-time code and as a bearer", async () => {
    expect((await socketWithCookie(thisComputer())).status).toBe(101);
    expect((await linkWithToken(thisComputer())).status).toBe(302);
    expect((await linkWithCode(thisComputer(), mintedCode())).status).toBe(302);
    expect((await devicesWithBearer(thisComputer())).status).toBe(200);
  });

  for (const [shape, headersOf] of Object.entries(forwardedShapes)) {
    test(`signs in nothing passed on by ${shape}`, async () => {
      const shaped = headersOf();
      expect((await socketWithCookie(shaped)).status).toBe(401);
      expect(await linkWithToken(shaped)).toEqual({ status: 403, body: BROWSER_TOKEN_ONLY_HERE });
      expect(await devicesWithBearer(shaped)).toEqual({ status: 403, body: BROWSER_TOKEN_ONLY_HERE });
      const code = mintedCode();
      expect(await linkWithCode(shaped, code)).toEqual({ status: 403, body: BROWSER_TOKEN_ONLY_HERE });
      expect((await linkWithCode(thisComputer(), code)).status, "a code tried from afar is not used up").toBe(302);
    });
  }
});
