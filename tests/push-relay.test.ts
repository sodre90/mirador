import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync } from "node:fs";
import http2, { type Http2SecureServer, type IncomingHttpHeaders, type ServerHttp2Stream } from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownServingCertificate } from "../host/certificates.ts";
import { Apns, type ApnsPush } from "../push-relay/apns.ts";
import { Fcm, type FcmPush } from "../push-relay/fcm.ts";
import { addHostToken, hostOf, hostTokenLabels, removeHostToken } from "../push-relay/host-tokens.ts";
import { relayHandler, type Senders } from "../push-relay/server.ts";
import { PUSH_BLOB_BYTES } from "../shared/push.ts";

const scratch = () => mkdtempSync(join(tmpdir(), "push-relay-"));
const fullBlob = Buffer.alloc(PUSH_BLOB_BYTES, 7).toString("base64");
const iosToken = "ab".repeat(32);
const androidToken = "fcm-token:" + "x".repeat(40);

function partsOf(jwt: string) {
  const [header, claims, signature] = jwt.split(".");
  return { header: JSON.parse(Buffer.from(header, "base64url").toString()), claims: JSON.parse(Buffer.from(claims, "base64url").toString()), signed: `${header}.${claims}`, signature: Buffer.from(signature, "base64url") };
}

describe("host tokens", () => {
  test("a Mac's token names it until its line is removed, and only its hash is kept", async () => {
    const file = join(scratch(), "tokens");
    const token = addHostToken(file, "studio-mac");
    expect(hostOf(file, token)).toBe("studio-mac");
    expect(hostOf(file, token + "x")).toBeNull();
    expect(await Bun.file(file).text()).not.toContain(token);
    expect(hostTokenLabels(file)).toEqual(["studio-mac"]);
    expect(() => addHostToken(file, "studio-mac")).toThrow();
    expect(() => addHostToken(file, "a label")).toThrow();
    removeHostToken(file, "studio-mac");
    expect(hostOf(file, token)).toBeNull();
  });
});

interface ApnsRequest {
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

describe("Apple", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const certificate = ownServingCertificate(scratch(), ["localhost", "127.0.0.1"]);
  const received: ApnsRequest[] = [];
  let answers: ((stream: ServerHttp2Stream) => void)[] = [];
  let server: Http2SecureServer;
  let origin: string;
  let clock = Date.UTC(2026, 9, 31);

  const answerWith = (status: number, reason?: string) => (stream: ServerHttp2Stream) => {
    stream.respond({ ":status": status });
    stream.end(reason ? JSON.stringify({ reason }) : "");
  };

  beforeAll(async () => {
    server = http2.createSecureServer({ cert: certificate.chain, key: certificate.key });
    server.on("stream", (stream, headers) => {
      let body = "";
      stream.on("data", (chunk) => (body += chunk));
      stream.on("end", () => {
        received.push({ headers, body: JSON.parse(body) });
        (answers.shift() ?? answerWith(200))(stream as ServerHttp2Stream);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `https://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const apns = () =>
    new Apns({
      key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      keyId: "KEY123",
      teamId: "TEAM456",
      topic: "com.sodre90.mirador",
      production: origin,
      sandbox: origin,
      connectOptions: { ca: certificate.authority! },
      now: () => clock,
    });
  const alert: ApnsPush = { kind: "alert", deviceToken: iosToken, sandbox: false, blob: fullBlob };

  test("an alert carries the blob, a mutable fallback alert and a provider token Apple can check", async () => {
    received.length = 0;
    const sender = apns();
    expect(await sender.send(alert)).toBe("sent");
    const [{ headers, body }] = received;
    expect(headers[":path"]).toBe(`/3/device/${iosToken}`);
    expect(headers["apns-push-type"]).toBe("alert");
    expect(headers["apns-topic"]).toBe("com.sodre90.mirador");
    expect(body.m).toBe(fullBlob);
    expect((body.aps as Record<string, unknown>)["mutable-content"]).toBe(1);
    const jwt = partsOf(String(headers.authorization).replace(/^bearer /, ""));
    expect(jwt.header).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(jwt.claims).toEqual({ iss: "TEAM456", iat: clock / 1000 });
    expect(verify("sha256", Buffer.from(jwt.signed), { key: publicKey, dsaEncoding: "ieee-p1363" }, jwt.signature)).toBe(true);
    sender.close();
  });

  test("a clear is a quiet background push carrying the blob, which wakes the app and shows nothing", async () => {
    received.length = 0;
    const sender = apns();
    expect(await sender.send({ ...alert, kind: "clear" })).toBe("sent");
    const [{ headers, body }] = received;
    expect(headers["apns-push-type"]).toBe("background");
    expect(headers["apns-priority"]).toBe("5");
    expect(headers["apns-topic"]).toBe("com.sodre90.mirador");
    expect(body).toEqual({ aps: { "content-available": 1 }, m: fullBlob });
    sender.close();
  });

  test("ending a Live Activity goes to the live activity topic with no blob", async () => {
    received.length = 0;
    const sender = apns();
    expect(await sender.send({ kind: "live-activity-end", deviceToken: iosToken, sandbox: true })).toBe("sent");
    const [{ headers, body }] = received;
    expect(headers["apns-push-type"]).toBe("liveactivity");
    expect(headers["apns-topic"]).toBe("com.sodre90.mirador.push-type.liveactivity");
    expect(body).toEqual({ aps: { timestamp: clock / 1000, event: "end", "content-state": {}, "dismissal-date": clock / 1000 } });
    sender.close();
  });

  test("the provider token is kept for 40 minutes, and signed again when Apple says it expired", async () => {
    received.length = 0;
    const sender = apns();
    await sender.send(alert);
    clock += 39 * 60_000;
    await sender.send(alert);
    clock += 2 * 60_000;
    await sender.send(alert);
    clock += 60_000;
    answers = [answerWith(403, "ExpiredProviderToken")];
    expect(await sender.send(alert)).toBe("sent");
    const issuedAt = received.map(({ headers }) => partsOf(String(headers.authorization).replace(/^bearer /, "")).claims.iat);
    expect(new Set(issuedAt.slice(0, 2)).size).toBe(1);
    expect(issuedAt[2]).toBeGreaterThan(issuedAt[1]);
    expect(issuedAt[4]).toBeGreaterThan(issuedAt[3]);
    sender.close();
  });

  test("pushes sent together share one provider token", async () => {
    received.length = 0;
    const sender = apns();
    expect(await Promise.all([sender.send(alert), sender.send(alert), sender.send(alert)])).toEqual(["sent", "sent", "sent"]);
    expect(new Set(received.map(({ headers }) => headers.authorization)).size).toBe(1);
    expect(Number(received[0].headers["apns-expiration"])).toBe(clock / 1000 + 86_400);
    received.length = 0;
    clock += 60_000;
    answers = [answerWith(403, "ExpiredProviderToken"), answerWith(403, "ExpiredProviderToken")];
    expect(await Promise.all([sender.send(alert), sender.send(alert)])).toEqual(["sent", "sent"]);
    expect(new Set(received.slice(2).map(({ headers }) => headers.authorization)).size).toBe(1);
    sender.close();
  });

  test("a phone Apple has forgotten is gone, and other refusals fail", async () => {
    const sender = apns();
    answers = [answerWith(410, "Unregistered")];
    expect(await sender.send(alert)).toBe("gone");
    answers = [answerWith(400, "BadDeviceToken")];
    expect(await sender.send(alert)).toBe("gone");
    answers = [answerWith(400, "PayloadTooLarge")];
    expect(await sender.send(alert)).toBe("failed");
    answers = [answerWith(503), answerWith(503)];
    expect(await sender.send(alert)).toBe("failed");
    sender.close();
  });

  test("a connection Apple closes is opened again for the next push", async () => {
    const sender = apns();
    answers = [
      (stream) => {
        answerWith(200)(stream);
        stream.session?.goaway();
      },
    ];
    expect(await sender.send(alert)).toBe("sent");
    await Bun.sleep(50);
    expect(await sender.send(alert)).toBe("sent");
    sender.close();
  });
});

describe("Google", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const assertions: string[] = [];
  const sends: { authorization: string | null; body: { message: Record<string, unknown> } }[] = [];
  let sendAnswers: Response[] = [];
  let issued = 0;
  let clock = Date.UTC(2026, 9, 31);
  const google = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/token") {
        assertions.push(new URLSearchParams(await request.text()).get("assertion")!);
        return Response.json({ access_token: `access-${++issued}`, expires_in: 3600 });
      }
      sends.push({ authorization: request.headers.get("authorization"), body: await request.json() });
      return sendAnswers.shift() ?? Response.json({ name: "projects/mirador/messages/1" });
    },
  });
  afterAll(() => google.stop(true));

  const androidAlert: FcmPush = { kind: "alert", deviceToken: androidToken, blob: fullBlob };
  const fcm = () =>
    new Fcm({
      account: { project_id: "mirador", client_email: "relay@mirador.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), token_uri: `${google.url}token` },
      origin: google.url.origin,
      now: () => clock,
    });

  test("a data message carries the blob, sent with an access token for the service account's signed assertion", async () => {
    expect(await fcm().send(androidAlert)).toBe("sent");
    const { authorization, body } = sends.at(-1)!;
    expect(authorization).toBe(`Bearer access-${issued}`);
    expect(body.message).toEqual({ token: androidToken, data: { m: fullBlob }, android: { priority: "high", ttl: "86400s" } });
    const jwt = partsOf(assertions.at(-1)!);
    expect(jwt.header.alg).toBe("RS256");
    expect(jwt.claims).toMatchObject({ iss: "relay@mirador.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/firebase.messaging", aud: `${google.url}token` });
    expect(verify("sha256", Buffer.from(jwt.signed), publicKey, jwt.signature)).toBe(true);
  });

  test("a clear goes at normal priority, so messages that show nothing don't cost the alerts their high priority", async () => {
    expect(await fcm().send({ ...androidAlert, kind: "clear" })).toBe("sent");
    expect(sends.at(-1)!.body.message).toEqual({ token: androidToken, data: { m: fullBlob }, android: { priority: "normal", ttl: "86400s" } });
  });

  test("the access token is reused until near its end, and replaced when Google refuses it", async () => {
    const sender = fcm();
    const before = issued;
    await sender.send(androidAlert);
    clock += 50 * 60_000;
    await sender.send(androidAlert);
    expect(issued).toBe(before + 1);
    clock += 6 * 60_000;
    await sender.send(androidAlert);
    expect(issued).toBe(before + 2);
    sendAnswers = [new Response(null, { status: 401 })];
    expect(await sender.send(androidAlert)).toBe("sent");
    expect(issued).toBe(before + 3);
  });

  test("pushes sent together ask Google for one access token", async () => {
    const sender = fcm();
    const before = issued;
    await Promise.all([sender.send(androidAlert), sender.send(androidAlert), sender.send(androidAlert)]);
    expect(issued).toBe(before + 1);
    clock += 56 * 60_000;
    await Promise.all([sender.send(androidAlert), sender.send(androidAlert)]);
    expect(issued).toBe(before + 2);
  });

  test("an unregistered phone is gone, and other refusals fail", async () => {
    const sender = fcm();
    sendAnswers = [Response.json({ error: { code: 404, details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } }, { status: 404 })];
    expect(await sender.send(androidAlert)).toBe("gone");
    sendAnswers = [Response.json({ error: { code: 400, details: [{ errorCode: "UNREGISTERED" }] } }, { status: 400 })];
    expect(await sender.send(androidAlert)).toBe("gone");
    sendAnswers = [Response.json({ error: { code: 429, details: [{ errorCode: "QUOTA_EXCEEDED" }] } }, { status: 429 })];
    expect(await sender.send(androidAlert)).toBe("failed");
  });
});

describe("the relay", () => {
  const tokensFile = join(scratch(), "tokens");
  const token = addHostToken(tokensFile, "studio-mac");
  const sent: unknown[] = [];
  let outcome: "sent" | "gone" | "failed" = "sent";
  const senders: Senders = {
    apns: { send: async (push) => (sent.push(push), outcome) },
    fcm: { send: async (push) => (sent.push(push), outcome) },
  };
  let clock = 0;
  const handle = relayHandler({ tokensFile, senders, perMinute: 3, now: () => clock });
  const push = (body: unknown, bearer: string | null = token) =>
    handle(new Request("http://relay/push", { method: "POST", headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, body: typeof body === "string" ? body : JSON.stringify(body) }));
  const alert = { platform: "ios", deviceToken: iosToken, kind: "alert", blob: fullBlob };

  test("passes a Mac's push on and answers with what came of it", async () => {
    expect((await push(alert)).status).toBe(200);
    expect(sent.at(-1)).toEqual({ kind: "alert", deviceToken: iosToken, sandbox: false, blob: fullBlob });
    expect((await push({ platform: "ios", deviceToken: iosToken, sandbox: true, kind: "live-activity-end" })).status).toBe(200);
    expect(sent.at(-1)).toEqual({ kind: "live-activity-end", deviceToken: iosToken, sandbox: true });
    outcome = "gone";
    const gone = await push({ platform: "android", deviceToken: androidToken, kind: "alert", blob: fullBlob });
    expect(gone.status).toBe(410);
    expect(await gone.json()).toEqual({ outcome: "gone" });
    expect(sent.at(-1)).toEqual({ kind: "alert", deviceToken: androidToken, blob: fullBlob });
    outcome = "sent";
  });

  test("passes a clear on to Apple and Google alike", async () => {
    clock += 60_000;
    expect((await push({ ...alert, kind: "clear" })).status).toBe(200);
    expect(sent.at(-1)).toEqual({ kind: "clear", deviceToken: iosToken, sandbox: false, blob: fullBlob });
    expect((await push({ platform: "android", deviceToken: androidToken, kind: "clear", blob: fullBlob })).status).toBe(200);
    expect(sent.at(-1)).toEqual({ kind: "clear", deviceToken: androidToken, blob: fullBlob });
  });

  test("refuses a missing or unknown token", async () => {
    expect((await push(alert, null)).status).toBe(401);
    expect((await push(alert, "not-a-token")).status).toBe(401);
  });

  test("refuses pushes whose blob isn't exactly the padded size, or that don't fit their kind", async () => {
    clock += 60_000;
    const before = sent.length;
    const statuses = await Promise.all(
      [
        { ...alert, blob: Buffer.alloc(PUSH_BLOB_BYTES - 1).toString("base64") },
        { ...alert, blob: undefined },
        { ...alert, deviceToken: "not hex" },
        { ...alert, platform: "windows" },
        { ...alert, sandbox: "yes" },
        { platform: "ios", deviceToken: iosToken, kind: "live-activity-end", blob: fullBlob },
        { platform: "android", deviceToken: androidToken, kind: "live-activity-end" },
        { ...alert, kind: "clear", blob: undefined },
        { ...alert, kind: "silent" },
        "not json",
        null,
      ].map(async (body) => (await push(body)).status),
    );
    expect(statuses.every((status) => status === 400)).toBe(true);
    expect(sent.length).toBe(before);
  });

  test("refuses a body too big for any push", async () => {
    expect((await push({ ...alert, padding: "x".repeat(5000) })).status).toBe(413);
  });

  test("holds each Mac to its pushes a minute", async () => {
    clock += 60_000;
    const statuses = [];
    for (const _ of [1, 2, 3, 4]) statuses.push((await push(alert)).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
    clock += 60_001;
    expect((await push(alert)).status).toBe(200);
  });

  test("fails a push for a platform the relay has no key for", async () => {
    clock += 60_000;
    const appleOnly = relayHandler({ tokensFile, senders: { ...senders, fcm: null } });
    const response = await appleOnly(new Request("http://relay/push", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ platform: "android", deviceToken: androidToken, kind: "alert", blob: fullBlob }) }));
    expect(response.status).toBe(502);
  });
});
