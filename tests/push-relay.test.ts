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
import { GRANT_LIFETIME_S, Grants } from "../push-relay/grants.ts";
import { addHostToken, hostOf, hostTokenLabels, removeHostToken } from "../push-relay/host-tokens.ts";
import { RateLimit } from "../push-relay/rate-limit.ts";
import { relayHandler, type Senders } from "../push-relay/server.ts";
import { PUSH_BLOB_BYTES, PUSH_GRANT_PATTERN, pushGrantExpiresAt } from "../shared/push.ts";

const scratch = () => mkdtempSync(join(tmpdir(), "push-relay-"));
const fullBlob = Buffer.alloc(PUSH_BLOB_BYTES, 7).toString("base64");
const iosToken = "ab".repeat(32);
const androidToken = "fcm-token:" + "x".repeat(40);
const grantSecret = "a relay's grant secret, long enough";
const requestId = "request-0123456789";

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

describe("grants", () => {
  let clock = Date.UTC(2026, 10, 15);
  const grants = new Grants(grantSecret, () => clock);
  const phone = { platform: "ios" as const, sandbox: false, deviceToken: iosToken };

  test("a grant lets the one device token it was made for push, until it expires", () => {
    const grant = grants.issue(phone);
    expect(grant).toMatch(PUSH_GRANT_PATTERN);
    expect(pushGrantExpiresAt(grant)).toBe(clock + GRANT_LIFETIME_S * 1000);
    expect(grants.allows(grant, phone)).toBe(true);
    expect(grants.allows(grant, { ...phone, deviceToken: "cd".repeat(32) })).toBe(false);
    expect(grants.allows(grant, { ...phone, sandbox: true })).toBe(false);
    expect(grants.allows(grant, { ...phone, platform: "android" })).toBe(false);
    clock += GRANT_LIFETIME_S * 1000;
    expect(grants.allows(grant, phone)).toBe(false);
  });

  test("only the relay's secret makes a grant, and a later expiry can't be written in", () => {
    const grant = grants.issue(phone);
    expect(new Grants(grantSecret.replace("long", "LONG"), () => clock).allows(grant, phone)).toBe(false);
    const [expiresAt, mac] = grant.split(".");
    expect(grants.allows(`${Number(expiresAt) + 86_400}.${mac}`, phone)).toBe(false);
    expect(grants.allows("not a grant", phone)).toBe(false);
    expect(() => new Grants("short")).toThrow();
  });
});

describe("rate limits", () => {
  test("count each key's uses in the window, and forget keys gone quiet", () => {
    let clock = 0;
    const limit = new RateLimit(2, 1_000, () => clock);
    expect([limit.allows("a"), limit.allows("a"), limit.allows("a"), limit.allows("b")]).toEqual([true, true, false, true]);
    clock += 1_001;
    expect(limit.allows("a")).toBe(true);
    expect(limit.keyCount).toBe(1);
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

  test("a grant is a quiet background push carrying the grant and the request it answers", async () => {
    received.length = 0;
    const sender = apns();
    expect(await sender.send({ kind: "grant", deviceToken: iosToken, sandbox: true, grant: "1234567890.mac", requestId })).toBe("sent");
    const [{ headers, body }] = received;
    expect(headers["apns-push-type"]).toBe("background");
    expect(headers["apns-priority"]).toBe("5");
    expect(body).toEqual({ aps: { "content-available": 1 }, g: "1234567890.mac", q: requestId });
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
    expect(Number(received[0].headers["apns-expiration"])).toBe(clock / 1000 + 1_800);
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
    expect(body.message).toEqual({ token: androidToken, data: { m: fullBlob }, android: { priority: "high", ttl: "1800s" } });
    const jwt = partsOf(assertions.at(-1)!);
    expect(jwt.header.alg).toBe("RS256");
    expect(jwt.claims).toMatchObject({ iss: "relay@mirador.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/firebase.messaging", aud: `${google.url}token` });
    expect(verify("sha256", Buffer.from(jwt.signed), publicKey, jwt.signature)).toBe(true);
  });

  test("a clear goes at normal priority, so messages that show nothing don't cost the alerts their high priority", async () => {
    expect(await fcm().send({ ...androidAlert, kind: "clear" })).toBe("sent");
    expect(sends.at(-1)!.body.message).toEqual({ token: androidToken, data: { m: fullBlob }, android: { priority: "normal", ttl: "1800s" } });
  });

  test("a grant goes as a normal priority data message with the request it answers", async () => {
    expect(await fcm().send({ kind: "grant", deviceToken: androidToken, grant: "1234567890.mac", requestId })).toBe("sent");
    expect(sends.at(-1)!.body.message).toEqual({ token: androidToken, data: { g: "1234567890.mac", q: requestId }, android: { priority: "normal", ttl: "1800s" } });
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

describe("the relay's grants", () => {
  const tokensFile = join(scratch(), "tokens");
  const token = addHostToken(tokensFile, "studio-mac");
  const sent: Record<string, unknown>[] = [];
  const senders: Senders = {
    apns: { send: async (push) => (sent.push(push), "sent") },
    fcm: { send: async (push) => (sent.push(push), "sent") },
  };
  let clock = Date.UTC(2026, 10, 15);
  const grants = new Grants(grantSecret, () => clock);
  const handle = relayHandler({ tokensFile, senders, grants, clientAddressHeader: "x-real-ip", perMinute: 2, grantAsksPerHour: 3, grantsPerDay: 2, now: () => clock });
  const ask = (body: unknown, address = "203.0.113.7") =>
    handle(new Request("http://relay/grant", { method: "POST", headers: { "x-real-ip": address }, body: JSON.stringify(body) }), "192.168.1.165");
  const push = (body: unknown) => handle(new Request("http://relay/push", { method: "POST", body: JSON.stringify(body) }));
  const iosAsk = { platform: "ios", deviceToken: iosToken, sandbox: true, requestId };
  const lastGrant = () => String(sent.at(-1)!.grant);

  test("a phone's grant goes to its own token in a push, never in the answer", async () => {
    const response = await ask(iosAsk);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ outcome: "sent" });
    expect(sent.at(-1)).toEqual({ kind: "grant", deviceToken: iosToken, sandbox: true, grant: expect.stringMatching(PUSH_GRANT_PATTERN), requestId });
    expect(grants.allows(lastGrant(), { platform: "ios", sandbox: true, deviceToken: iosToken })).toBe(true);
    expect((await ask({ platform: "android", deviceToken: androidToken, sandbox: true, requestId })).status).toBe(202);
    expect(sent.at(-1)).toEqual({ kind: "grant", deviceToken: androidToken, grant: expect.stringMatching(PUSH_GRANT_PATTERN), requestId });
    expect(grants.allows(lastGrant(), { platform: "android", sandbox: false, deviceToken: androidToken }), "Android has no sandbox").toBe(true);
  });

  test("a Mac pushes with a phone's grant to that phone alone, and with no grant at all for a Live Activity", async () => {
    clock += 60_000;
    await ask({ ...iosAsk, sandbox: false });
    const grant = lastGrant();
    const alert = { platform: "ios", deviceToken: iosToken, kind: "alert", blob: fullBlob, grant };
    expect((await push(alert)).status).toBe(200);
    expect(sent.at(-1)).toEqual({ kind: "alert", deviceToken: iosToken, sandbox: false, blob: fullBlob });
    expect((await push({ ...alert, deviceToken: "cd".repeat(32) })).status).toBe(401);
    expect((await push({ ...alert, sandbox: true })).status).toBe(401);
    expect((await push({ platform: "ios", deviceToken: iosToken, kind: "live-activity-end", grant })).status).toBe(401);
    expect((await push({ ...alert, grant: undefined })).status).toBe(401);
    expect((await push({ ...alert, grant: "not a grant" })).status).toBe(400);
  });

  test("holds each phone's grant to its pushes a minute, apart from the Macs' own", async () => {
    clock += 60_000;
    const alert = { platform: "android", deviceToken: androidToken, kind: "alert", blob: fullBlob, grant: grants.issue({ platform: "android", sandbox: false, deviceToken: androidToken }) };
    const statuses = [];
    for (const _ of [1, 2, 3]) statuses.push((await push(alert)).status);
    expect(statuses).toEqual([200, 200, 429]);
    const withToken = await handle(new Request("http://relay/push", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ ...alert, grant: undefined }) }));
    expect(withToken.status).toBe(200);
    clock += 60_001;
    expect((await push(alert)).status).toBe(200);
  });

  test("an expired grant pushes nothing", async () => {
    const alert = { platform: "android", deviceToken: androidToken, kind: "alert", blob: fullBlob, grant: grants.issue({ platform: "android", sandbox: false, deviceToken: androidToken }) };
    clock += GRANT_LIFETIME_S * 1000;
    expect((await push(alert)).status).toBe(401);
  });

  test("refuses asks that aren't one", async () => {
    clock += 86_400_000;
    const statuses = await Promise.all(
      [{ ...iosAsk, deviceToken: "not hex" }, { ...iosAsk, platform: "windows" }, { ...iosAsk, sandbox: "yes" }, { ...iosAsk, requestId: "short" }, { ...iosAsk, requestId: undefined }, "not json", null].map(
        async (body) => (await ask(body)).status,
      ),
    );
    expect(statuses.every((status) => status === 400)).toBe(true);
  });

  test("gives a device token a few grants a day, and an address a few asks an hour, by the address its proxy names", async () => {
    clock += 86_400_000;
    const otherToken = (index: number) => `${index}`.padStart(64, "e");
    expect([(await ask(iosAsk)).status, (await ask(iosAsk)).status, (await ask(iosAsk, "198.51.100.1")).status]).toEqual([202, 202, 429]);
    expect([(await ask({ ...iosAsk, deviceToken: otherToken(1) })).status, (await ask({ ...iosAsk, deviceToken: otherToken(2) })).status]).toEqual([202, 429]);
    expect((await ask({ ...iosAsk, deviceToken: otherToken(3) }, "198.51.100.1")).status).toBe(202);
    clock += 3_600_001;
    expect((await ask({ ...iosAsk, deviceToken: otherToken(4) })).status).toBe(202);
    expect((await ask(iosAsk, "198.51.100.2")).status, "a day for each token").toBe(429);
  });

  test("a relay without a grant secret makes no grants and takes none", async () => {
    const tokensOnly = relayHandler({ tokensFile, senders, now: () => clock });
    expect((await tokensOnly(new Request("http://relay/grant", { method: "POST", body: JSON.stringify(iosAsk) }))).status).toBe(404);
    const alert = { platform: "ios", deviceToken: iosToken, kind: "alert", blob: fullBlob, grant: grants.issue({ platform: "ios", sandbox: false, deviceToken: iosToken }) };
    expect((await tokensOnly(new Request("http://relay/push", { method: "POST", body: JSON.stringify(alert) }))).status).toBe(401);
  });
});
