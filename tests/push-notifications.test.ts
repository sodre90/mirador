import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../host/config.ts";
import { pushRegistrationProblem, PushNotifications } from "../host/push-notifications.ts";
import { Store } from "../host/store.ts";
import { DEFAULT_PUSH_RELAY, openedPushBlob, PUSH_BLOB_BYTES, pushRelayAddressProblem, pushRelayHost, sealedPushBlob, type ClearMessage, type PushKey, type PushMessage, type PushRegistration, type PushRequest } from "../shared/push.ts";
import type { SystemNotification } from "../shared/system-notifications.ts";
import vector from "../shared/push-test-vector.json";
import { storeWithConversation } from "./canvas-plugin-host.ts";

const pushKey: PushKey = { keyId: Buffer.alloc(16, 1).toString("base64url"), key: Buffer.alloc(32, 2).toString("base64url") };
const message: PushMessage = {
  id: "8d6c3f0e-0b6e-4c43-9e2a-6c1f2b7d9a10",
  sentAt: 1_793_404_800_000,
  notification: { kind: "question", conversationId: "c1", title: "Fix the login test", workspace: "mirador", body: "Asks: Which branch?" },
};

describe("push blobs", () => {
  test("are always the same size, and open with the phone's key to what the Mac sealed", async () => {
    const blob = await sealedPushBlob(pushKey, message);
    expect(Buffer.from(blob, "base64").length).toBe(PUSH_BLOB_BYTES);
    expect(Buffer.from(blob, "base64").subarray(0, 16).toString("base64url")).toBe(pushKey.keyId);
    expect(await openedPushBlob(pushKey, blob)).toEqual(message);
  });

  test("don't open with another key, or once changed", async () => {
    const blob = Buffer.from(await sealedPushBlob(pushKey, message), "base64");
    const otherKey = { ...pushKey, key: Buffer.alloc(32, 3).toString("base64url") };
    expect(openedPushBlob(otherKey, blob.toString("base64"))).rejects.toThrow();
    blob[100] ^= 1;
    expect(openedPushBlob(pushKey, blob.toString("base64"))).rejects.toThrow();
  });

  test("cut long titles and bodies by bytes to fit, whatever their script", async () => {
    const long = { ...message, notification: { ...message.notification, title: "修正🙂".repeat(400), workspace: "ワーク".repeat(100), body: "😀".repeat(300) } };
    const opened = await openedPushBlob(pushKey, await sealedPushBlob(pushKey, long));
    expect(opened.notification.title.endsWith("…")).toBe(true);
    expect(opened.notification.title.startsWith("修正🙂修正")).toBe(true);
    expect(opened.notification.body.length).toBeGreaterThan(0);
    expect(opened.id).toBe(message.id);
  });

  /** The phone's notification extension and FCM service check their decryption against this blob. */
  test("match the shared test vector", async () => {
    const { keyId, key, nonce, message, blob } = vector;
    expect(await sealedPushBlob({ keyId, key }, message, Buffer.from(nonce, "base64"))).toBe(blob);
    expect(await openedPushBlob({ keyId, key }, blob)).toEqual(message);
    const { clear } = vector;
    expect(await sealedPushBlob({ keyId, key }, clear.message, Buffer.from(clear.nonce, "base64"))).toBe(clear.blob);
  });
});

const grant = `1795000000.${"g".repeat(43)}`;
const GRANT_RELAY = "https://push.mirador.example";

const registration = (kinds: PushRegistration["kinds"] = ["question", "permission"], grant: string | null = null): PushRegistration => ({
  platform: "ios",
  deviceToken: "ab".repeat(32),
  sandbox: true,
  ...pushKey,
  kinds,
  grant,
});

function pushingHost(answer: { status: number; outcome: string } = { status: 200, outcome: "sent" }, { ownRelay = true } = {}) {
  const store = storeWithConversation();
  const posted: { url: string; authorization: string | null; request: PushRequest }[] = [];
  const post = (async (url: URL, init: RequestInit) => {
    posted.push({ url: String(url), authorization: new Headers(init.headers).get("authorization"), request: JSON.parse(String(init.body)) });
    return Response.json({ outcome: answer.outcome }, { status: answer.status });
  }) as unknown as typeof fetch;
  const pushes = new PushNotifications(store, { shownWaitMs: 10, post, grantRelay: GRANT_RELAY });
  store.insertDevice({ id: "phone", name: "Peter's iPhone", joinedAt: 1, lastSeenAt: 1 }, "hash");
  if (ownRelay) store.setPushRelay("https://push.example.com", "relay-token");
  return { store, pushes, posted, post };
}

const notification: SystemNotification = { id: "n1", kind: "question", conversationId: "c1", title: "Fix the login test", workspace: "mirador", body: "Asks: Which branch?" };

describe("pushing notifications", () => {
  test("a registered phone that doesn't say it showed the notification gets it pushed, sealed with its key", async () => {
    const { pushes, posted } = pushingHost();
    pushes.register("phone", registration());
    await pushes.notify(notification);
    expect(posted).toHaveLength(1);
    const [{ url, authorization, request }] = posted;
    expect(url).toBe("https://push.example.com/push");
    expect(authorization).toBe("Bearer relay-token");
    expect(request).toMatchObject({ platform: "ios", deviceToken: "ab".repeat(32), sandbox: true, kind: "alert" });
    const opened = await openedPushBlob(pushKey, request.blob!);
    expect(opened.id).toBe("n1");
    expect(opened.notification).toEqual({ kind: "question", conversationId: "c1", title: "Fix the login test", workspace: "mirador", body: "Asks: Which branch?" });
  });

  test("a phone that showed it gets no push", async () => {
    const { pushes, posted } = pushingHost();
    pushes.register("phone", registration());
    const pushed = pushes.notify(notification);
    pushes.shown("phone", "n1");
    await pushed;
    expect(posted).toHaveLength(0);
  });

  test("a phone newer than the host keeps the kinds the host knows, and gets those", async () => {
    const { pushes, posted } = pushingHost();
    pushes.register("phone", registration(["question", "from-the-future" as "question"]));
    await pushes.notify(notification);
    expect(posted).toHaveLength(1);
  });

  test("a phone gets no push of a kind it didn't register for", async () => {
    const { pushes, posted } = pushingHost();
    pushes.register("phone", registration(["permission"]));
    await pushes.notify(notification);
    expect(posted).toHaveLength(0);
  });

  test("another machine's notification passed on through this one is not pushed", async () => {
    const { pushes, posted } = pushingHost();
    pushes.register("phone", registration());
    await pushes.notify({ ...notification, machineId: "other-mac" });
    expect(posted).toHaveLength(0);
  });

  test("with no relay of its own, the Mac pushes through the grant relay with the phone's grant instead of a token", async () => {
    const { pushes, posted } = pushingHost(undefined, { ownRelay: false });
    pushes.register("phone", registration(undefined, grant));
    await pushes.notify(notification);
    expect(posted).toHaveLength(1);
    const [{ url, authorization, request }] = posted;
    expect(url).toBe(`${GRANT_RELAY}/push`);
    expect(authorization).toBeNull();
    expect(request).toMatchObject({ platform: "ios", deviceToken: "ab".repeat(32), sandbox: true, kind: "alert", grant });
  });

  test("a relay of its own goes with the Mac's token, and no phone's grant", async () => {
    const { pushes, posted } = pushingHost();
    pushes.register("phone", registration(undefined, grant));
    await pushes.notify(notification);
    expect(posted.map(({ url, authorization, request }) => [url, authorization, request.grant])).toEqual([["https://push.example.com/push", "Bearer relay-token", undefined]]);
  });

  test("a phone with no grant yet gets nothing pushed while the Mac has no relay of its own, nor does any where there's no grant relay", async () => {
    const { store, pushes, posted, post } = pushingHost(undefined, { ownRelay: false });
    pushes.register("phone", registration());
    await pushes.notify(notification);
    expect(posted).toHaveLength(0);
    pushes.register("phone", registration(undefined, grant));
    await new PushNotifications(store, { shownWaitMs: 10, post, grantRelay: null }).notify(notification);
    expect(posted).toHaveLength(0);
  });

  test("pages and phones learn where the Mac pushes, and where phones get their grants", () => {
    const { store, pushes } = pushingHost(undefined, { ownRelay: false });
    expect(pushes.relaySetting()).toEqual({ address: null, tokenSet: false, grantRelay: GRANT_RELAY });
    store.setPushRelay("https://push.example.com", "relay-token");
    expect(pushes.relaySetting()).toEqual({ address: "https://push.example.com", tokenSet: true, grantRelay: GRANT_RELAY });
  });

  test("a phone the relay says is gone is forgotten, and one it failed for is kept", async () => {
    const failing = pushingHost({ status: 502, outcome: "failed" });
    failing.pushes.register("phone", registration());
    await failing.pushes.notify(notification);
    expect(failing.store.pushRegistrations()).toHaveLength(1);
    const gone = pushingHost({ status: 410, outcome: "gone" });
    gone.pushes.register("phone", registration());
    await gone.pushes.notify(notification);
    expect(gone.store.pushRegistrations()).toHaveLength(0);
  });

  test("once a notified conversation has waited and stops, the phones told of it get a clear", async () => {
    const { pushes, posted } = pushingHost();
    pushes.register("phone", registration());
    await pushes.notify(notification);
    await pushes.waitingChanged(new Set(["c1"]));
    expect(posted).toHaveLength(1);
    await pushes.waitingChanged(new Set());
    expect(posted).toHaveLength(2);
    const { request } = posted[1];
    expect(request).toMatchObject({ platform: "ios", deviceToken: "ab".repeat(32), sandbox: true, kind: "clear" });
    expect(Buffer.from(request.blob!, "base64").length).toBe(PUSH_BLOB_BYTES);
    expect((await openedPushBlob<ClearMessage>(pushKey, request.blob!)).cleared).toEqual({ conversationId: "c1" });
    await pushes.waitingChanged(new Set());
    expect(posted).toHaveLength(2);
  });

  test("a conversation not yet seen waiting isn't cleared, as its notification can come first", async () => {
    const { pushes, posted } = pushingHost();
    pushes.register("phone", registration());
    await pushes.notify(notification);
    await pushes.waitingChanged(new Set(["other"]));
    expect(posted.map(({ request }) => request.kind)).toEqual(["alert"]);
  });

  test("a conversation already waiting when notified is cleared once it stops", async () => {
    const { pushes, posted } = pushingHost();
    pushes.register("phone", registration());
    await pushes.waitingChanged(new Set(["c1"]));
    await pushes.notify(notification);
    await pushes.waitingChanged(new Set());
    expect(posted.map(({ request }) => request.kind)).toEqual(["alert", "clear"]);
  });

  test("a phone that showed the notification itself gets the clear too", async () => {
    const { pushes, posted } = pushingHost();
    pushes.register("phone", registration());
    const pushed = pushes.notify(notification);
    pushes.shown("phone", "n1");
    await pushed;
    await pushes.waitingChanged(new Set(["c1"]));
    await pushes.waitingChanged(new Set());
    expect(posted.map(({ request }) => request.kind)).toEqual(["clear"]);
  });

  test("a host restarted while a notified conversation waited clears it once it stops", async () => {
    const { store, pushes, posted, post } = pushingHost();
    pushes.register("phone", registration());
    await pushes.notify(notification);
    await pushes.waitingChanged(new Set(["c1"]));

    const restarted = new PushNotifications(store, { shownWaitMs: 10, post });
    await restarted.waitingChanged(new Set(["c1"]));
    expect(posted.map(({ request }) => request.kind)).toEqual(["alert"]);

    await restarted.waitingChanged(new Set());
    expect(posted.map(({ request }) => request.kind)).toEqual(["alert", "clear"]);
  });

  test("a host restarted after its notified conversation stopped waiting clears it at once", async () => {
    const { store, pushes, posted, post } = pushingHost();
    pushes.register("phone", registration());
    await pushes.notify(notification);
    await pushes.waitingChanged(new Set(["c1"]));

    const restarted = new PushNotifications(store, { shownWaitMs: 10, post });
    await restarted.waitingChanged(new Set());
    expect(posted.map(({ request }) => request.kind)).toEqual(["alert", "clear"]);
  });

  test("a notified conversation deleted while it waits is cleared on the phones told of it", async () => {
    const { store, pushes, posted } = pushingHost();
    pushes.register("phone", registration());
    await pushes.notify(notification);
    await pushes.waitingChanged(new Set(["c1"]));
    store.deleteConversation("c1");
    await pushes.waitingChanged(new Set());
    expect(posted.map(({ request }) => request.kind)).toEqual(["alert", "clear"]);
  });

  test("a conversation read before its push went out isn't pushed", async () => {
    const { pushes, posted } = pushingHost();
    pushes.register("phone", registration());
    const pushed = pushes.notify(notification);
    await pushes.waitingChanged(new Set(["c1"]));
    await pushes.waitingChanged(new Set());
    await pushed;
    expect(posted).toHaveLength(0);
  });

  test("a notification whose conversation doesn't wait for it is never cleared", async () => {
    const { pushes, posted } = pushingHost();
    pushes.register("phone", registration(["job-ended"]));
    await pushes.notify({ ...notification, kind: "job-ended" });
    await pushes.waitingChanged(new Set(["c1"]));
    await pushes.waitingChanged(new Set());
    expect(posted.map(({ request }) => request.kind)).toEqual(["alert"]);
  });

  test("a revoked phone's registration goes with it", () => {
    const { store, pushes } = pushingHost();
    pushes.register("phone", registration());
    store.deleteDevice("phone");
    expect(store.pushRegistrations()).toHaveLength(0);
  });

  test("registering again replaces the phone's registration, keeping only its known fields", () => {
    const { store, pushes } = pushingHost();
    pushes.register("phone", registration());
    pushes.register("phone", { ...registration(["finished"], grant), extra: "dropped" } as PushRegistration);
    expect(store.pushRegistrations()).toEqual([{ deviceId: "phone", registration: registration(["finished"], grant) }]);
  });
});

describe("push settings", () => {
  test("the relay's token is kept for the same address only, so it never goes to another relay", () => {
    const store = new Store(":memory:");
    store.setPushRelay("https://push.example.com", "relay-token");
    store.setPushRelay("https://push.example.com", null);
    expect(store.pushRelay()).toEqual({ address: "https://push.example.com", token: "relay-token" });
    store.setPushRelay("https://push.example.co", null);
    expect(store.pushRelay()).toBeNull();
    expect(store.pushRelaySetting()).toEqual({ address: "https://push.example.co", tokenSet: false });
    store.setPushRelay("https://push.example.com", "relay-token");
    store.setPushRelay(null, null);
    expect(store.pushRelaySetting()).toEqual({ address: null, tokenSet: false });
  });

  test("a relay's address is just its origin, so /push goes on it alone", () => {
    expect(pushRelayAddressProblem("https://push.example.com/")).toBeNull();
    expect(pushRelayAddressProblem("https://push.example.com/health")).not.toBeNull();
    expect(pushRelayAddressProblem("https://push.example.com?x=1")).not.toBeNull();
    expect(pushRelayAddressProblem("https://user:pass@push.example.com")).not.toBeNull();
  });

  test("a relay is reached over HTTPS, or plain HTTP on this machine", () => {
    expect(pushRelayAddressProblem("https://push.example.com")).toBeNull();
    expect(pushRelayAddressProblem("http://127.0.0.1:8790")).toBeNull();
    expect(pushRelayAddressProblem("http://push.example.com")).not.toBeNull();
    expect(pushRelayAddressProblem("push.example.com")).not.toBeNull();
  });

  test("the relay MIRADOR_PUSH_RELAY names is checked at the start like one Settings take, and kept as its origin", () => {
    const grantRelayOf = (value?: string) =>
      loadConfig({ MIRADOR_DATA_DIR: mkdtempSync(join(tmpdir(), "mirador-push-relay-")), ...(value !== undefined && { MIRADOR_PUSH_RELAY: value }) }).pushGrantRelay;
    expect(grantRelayOf()).toBe(DEFAULT_PUSH_RELAY);
    expect(grantRelayOf("")).toBe(DEFAULT_PUSH_RELAY);
    expect(grantRelayOf("off")).toBeNull();
    expect(grantRelayOf("https://push.example.com/")).toBe("https://push.example.com");
    expect(grantRelayOf("http://127.0.0.1:8790")).toBe("http://127.0.0.1:8790");
    expect(() => grantRelayOf("push.example.com")).toThrow("MIRADOR_PUSH_RELAY: The push relay's address isn't a web address.");
    expect(() => grantRelayOf("https://push.example.com/health")).toThrow(/^MIRADOR_PUSH_RELAY: /);
  });

  test("Settings name the relay's host, and none for an address that isn't a web address", () => {
    expect(pushRelayHost("https://push.example.com")).toBe("push.example.com");
    expect(pushRelayHost(null)).toBeNull();
    expect(pushRelayHost("push.example.com")).toBeNull();
  });

  test("a registration needs a known platform, a token, a list of kinds and a key of the right size", () => {
    expect(pushRegistrationProblem(registration())).toBeNull();
    expect(pushRegistrationProblem({ ...registration(), platform: "windows" as "ios" })).not.toBeNull();
    expect(pushRegistrationProblem({ ...registration(), deviceToken: "" })).not.toBeNull();
    expect(pushRegistrationProblem({ ...registration(), deviceToken: "not-hex-".repeat(10) })).not.toBeNull();
    expect(pushRegistrationProblem({ ...registration(), platform: "android", deviceToken: "fcm-token:" + "x".repeat(40) })).toBeNull();
    expect(pushRegistrationProblem({ ...registration(), kinds: "question" as unknown as ["question"] })).not.toBeNull();
    expect(pushRegistrationProblem({ ...registration(), kinds: [3 as unknown as "question"] })).not.toBeNull();
    expect(pushRegistrationProblem({ ...registration(), key: Buffer.alloc(16).toString("base64url") })).not.toBeNull();
    expect(pushRegistrationProblem({ ...registration(), keyId: "not base64url!" })).not.toBeNull();
    expect(pushRegistrationProblem(registration(undefined, grant))).toBeNull();
    expect(pushRegistrationProblem(registration(undefined, "not a grant"))).not.toBeNull();
    expect(pushRegistrationProblem({ ...registration(), grant: undefined as unknown as null })).not.toBeNull();
  });
});
