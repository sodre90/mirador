import { DEVICE_TOKEN_PATTERNS, isPushKey, sealedPushBlob, type ClearMessage, type PushKind, type PushMessage, type PushOutcome, type PushRegistration, type PushRequest } from "../shared/push.ts";
import type { NotificationKind, SystemNotification } from "../shared/system-notifications.ts";
import type { Store } from "./store.ts";
import type { HostProblem } from "../shared/host-problems.ts";

/** How long a phone with a connection gets to say it showed a notification before the Mac pushes it too. */
export const SHOWN_WAIT_MS = 5_000;
const RELAY_TIMEOUT_MS = 20_000;
const NOTIFICATION_KINDS = new Set<NotificationKind>(["question", "permission", "finished", "error", "job-ended", "join-request"]);
/** The kinds whose conversation waits for you until it's read or answered, which takes their notification away. */
const WAITING_KINDS = new Set<NotificationKind>(["question", "permission", "finished", "error"]);

export interface PushNotificationsOptions {
  shownWaitMs?: number;
  post?: typeof fetch;
}

/** A relay is reached over HTTPS; plain HTTP only on this machine, for trying one out. */
export function pushRelayAddressProblem(address: string): HostProblem | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return { code: "push-relay-not-web-address" };
  }
  const onThisMachine = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && onThisMachine)) return { code: "push-relay-needs-https" };
  const justOrigin = url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  return justOrigin ? null : { code: "push-relay-is-origin" };
}

export function pushRegistrationProblem(registration: PushRegistration): string | null {
  const { platform, deviceToken, sandbox, kinds } = registration;
  if (platform !== "ios" && platform !== "android") return "Pushes go to iPhones and Android phones only.";
  if (typeof deviceToken !== "string" || !DEVICE_TOKEN_PATTERNS[platform].test(deviceToken)) return "The phone's push token isn't one.";
  if (typeof sandbox !== "boolean" || !Array.isArray(kinds) || !kinds.every((kind) => NOTIFICATION_KINDS.has(kind))) return "The push registration isn't one.";
  return typeof registration.keyId === "string" && typeof registration.key === "string" && isPushKey(registration) ? null : "The phone's push key isn't one.";
}

const registrationOf = ({ platform, deviceToken, sandbox, keyId, key, kinds }: PushRegistration): PushRegistration => ({ platform, deviceToken, sandbox, keyId, key, kinds });

/** The phones told that a conversation waits, and whether this machine has seen it waiting since. */
interface ToldOfWaiting {
  devices: Set<string>;
  seenWaiting: boolean;
}

/**
 * Pushes each notification, through the relay, to the phones that registered for its kind and didn't say they showed
 * it in time: a phone whose app is connected and awake shows it itself, and one that went away doesn't answer. Once a
 * conversation it told phones about stops waiting, it pushes them a clear, which takes the notification away.
 */
export class PushNotifications {
  private readonly shownOn = new Map<string, Set<string>>();
  private readonly toldOf = new Map<string, ToldOfWaiting>();
  private waiting = new Set<string>();
  private readonly shownWaitMs: number;
  private readonly post: typeof fetch;

  constructor(
    private readonly store: Store,
    { shownWaitMs = SHOWN_WAIT_MS, post = fetch }: PushNotificationsOptions = {},
  ) {
    this.shownWaitMs = shownWaitMs;
    this.post = post;
  }

  register(deviceId: string, registration: PushRegistration) {
    const problem = pushRegistrationProblem(registration);
    if (problem) throw new Error(problem);
    this.store.setPushRegistration(deviceId, registrationOf(registration));
  }

  unregister(deviceId: string) {
    this.store.deletePushRegistration(deviceId);
  }

  shown(deviceId: string, notificationId: string) {
    this.shownOn.get(notificationId)?.add(deviceId);
  }

  /** Another machine's notifications reach phones from that machine, which they join themselves. */
  notify(notification: SystemNotification): Promise<void> {
    const { id, kind, conversationId, title, workspace, body } = notification;
    if (!id || notification.machineId || !this.store.pushRelay() || this.store.pushRegistrations().length === 0) return Promise.resolve();
    this.shownOn.set(id, new Set());
    const told = conversationId && WAITING_KINDS.has(kind) ? this.toldOfWaiting(conversationId) : null;
    return new Promise((resolve) =>
      setTimeout(() => {
        const shownOn = this.shownOn.get(id)!;
        this.shownOn.delete(id);
        if (told && this.toldOf.get(conversationId!) !== told) return resolve();
        shownOn.forEach((deviceId) => told?.devices.add(deviceId));
        const unshown = this.store.pushRegistrations().filter(({ deviceId, registration }) => !shownOn.has(deviceId) && registration.kinds.includes(kind));
        unshown.forEach(({ deviceId }) => told?.devices.add(deviceId));
        const message: PushMessage = { id, sentAt: Date.now(), notification: { kind, conversationId, title, workspace, body } };
        void Promise.all(unshown.map(({ deviceId, registration }) => this.push(deviceId, registration, "alert", message))).then(() => resolve());
      }, this.shownWaitMs),
    );
  }

  /** The conversations that wait for you now; one that phones were told of and that stopped waiting gets cleared on them. */
  waitingChanged(waiting: Set<string>): Promise<void> {
    this.waiting = waiting;
    const settled = [...this.toldOf].filter(([conversationId, told]) => {
      if (waiting.has(conversationId)) told.seenWaiting = true;
      return told.seenWaiting && !waiting.has(conversationId);
    });
    settled.forEach(([conversationId]) => this.toldOf.delete(conversationId));
    return Promise.all(settled.map(([conversationId, { devices }]) => this.clear(conversationId, devices))).then(() => {});
  }

  /** A notification can come before its conversation shows as waiting, so it counts as settled only once it has waited. */
  private toldOfWaiting(conversationId: string) {
    const told = this.toldOf.get(conversationId) ?? { devices: new Set<string>(), seenWaiting: false };
    told.seenWaiting ||= this.waiting.has(conversationId);
    this.toldOf.set(conversationId, told);
    return told;
  }

  private async clear(conversationId: string, devices: Set<string>) {
    const message: ClearMessage = { id: crypto.randomUUID(), sentAt: Date.now(), cleared: { conversationId } };
    const told = this.store.pushRegistrations().filter(({ deviceId }) => devices.has(deviceId));
    await Promise.all(told.map(({ deviceId, registration }) => this.push(deviceId, registration, "clear", message)));
  }

  private async push(deviceId: string, registration: PushRegistration, kind: Exclude<PushKind, "live-activity-end">, message: PushMessage | ClearMessage) {
    const relay = this.store.pushRelay();
    if (!relay) return;
    const blob = await sealedPushBlob(registration, message);
    const request: PushRequest = { platform: registration.platform, deviceToken: registration.deviceToken, sandbox: registration.sandbox, kind, blob };
    const outcome = await this.post(`${relay.address.replace(/\/+$/, "")}/push`, {
      method: "POST",
      headers: { authorization: `Bearer ${relay.token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    })
      .then(async (response) => ({ status: response.status, outcome: ((await response.json().catch(() => ({}))) as { outcome?: PushOutcome | "refused" }).outcome }))
      .catch(() => ({ status: 0, outcome: undefined }));
    if (outcome.outcome === "gone") return this.store.deletePushRegistration(deviceId);
    if (outcome.status !== 200) console.warn(`The push relay didn't push to device ${deviceId}: ${outcome.status === 0 ? "no answer" : `${outcome.status} ${outcome.outcome ?? ""}`.trim()}`);
  }
}
