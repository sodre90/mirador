import { HostProblemError } from "../shared/host-problems.ts";
import {
  DEVICE_TOKEN_PATTERNS,
  isPushKey,
  PUSH_GRANT_PATTERN,
  PUSH_RELAY_CHOICES,
  pushRelayAddressProblem,
  sealedPushBlob,
  type ClearMessage,
  type PushKind,
  type PushMessage,
  type PushOutcome,
  type PushRegistration,
  type PushRelayRequest,
  type PushRelaySetting,
  type PushRequest,
} from "../shared/push.ts";
import type { NotificationKind, SystemNotification } from "../shared/system-notifications.ts";
import type { Store } from "./store.ts";

/** How long a phone with a connection gets to say it showed a notification before the Mac pushes it too. */
export const SHOWN_WAIT_MS = 5_000;
const RELAY_TIMEOUT_MS = 20_000;
export const NOTIFICATION_KINDS = new Set<NotificationKind>(["question", "permission", "finished", "error", "job-ended", "join-request", "reminder"]);
/** The kinds whose conversation waits for you until it's read or answered, which takes their notification away. */
const WAITING_KINDS = new Set<NotificationKind>(["question", "permission", "finished", "error", "reminder"]);

export interface PushNotificationsOptions {
  shownWaitMs?: number;
  post?: typeof fetch;
  /** Where to push with phones' grants while Settings name no relay of their own; null to push with none. */
  grantRelay?: string | null;
}

export function pushRegistrationProblem(registration: PushRegistration): string | null {
  const { platform, deviceToken, sandbox, kinds, grant } = registration;
  if (platform !== "ios" && platform !== "android") return "Pushes go to iPhones and Android phones only.";
  if (typeof deviceToken !== "string" || !DEVICE_TOKEN_PATTERNS[platform].test(deviceToken)) return "The phone's push token isn't one.";
  if (typeof sandbox !== "boolean" || !Array.isArray(kinds) || !kinds.every((kind) => typeof kind === "string")) return "The push registration isn't one.";
  if (grant !== null && (typeof grant !== "string" || !PUSH_GRANT_PATTERN.test(grant))) return "The phone's relay grant isn't one.";
  return typeof registration.keyId === "string" && typeof registration.key === "string" && isPushKey(registration) ? null : "The phone's push key isn't one.";
}

/** A phone newer than this host may ask for kinds it doesn't know yet; it gets the ones it knows. */
const registrationOf = ({ platform, deviceToken, sandbox, keyId, key, kinds, grant }: PushRegistration): PushRegistration => ({
  platform,
  deviceToken,
  sandbox,
  keyId,
  key,
  kinds: kinds.filter((kind) => NOTIFICATION_KINDS.has(kind)),
  grant,
});

/** Where a push to one phone goes: the relay Settings name, with this Mac's token, or the grant relay, with the phone's grant. */
interface PushRoute {
  address: string;
  token: string | null;
  grant: string | null;
}

/** The phones told that a conversation waits, and whether this machine has seen it waiting since; the store keeps it too, so a restart can still clear. */
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
  private readonly grantRelay: string | null;

  constructor(
    private readonly store: Store,
    { shownWaitMs = SHOWN_WAIT_MS, post = fetch, grantRelay = null }: PushNotificationsOptions = {},
  ) {
    this.shownWaitMs = shownWaitMs;
    this.post = post;
    this.grantRelay = grantRelay;
    store.pushTold().forEach(({ conversationId, devices, seenWaiting }) => this.toldOf.set(conversationId, { devices: new Set(devices), seenWaiting }));
  }

  /** What pages and phones learn of where this Mac pushes; while it pushes none, phones ask no relay for a grant. */
  relaySetting(): PushRelaySetting {
    return { ...this.store.pushRelaySetting(), grantRelay: this.grantRelayInUse(), miradorRelay: this.grantRelay };
  }

  /** A relay of your own needs a web origin and, unless it keeps the one set for that address, this machine's token. */
  chooseRelay(relay: PushRelayRequest) {
    if (!PUSH_RELAY_CHOICES.includes(relay.choice)) throw new Error(`There is no push relay choice "${relay.choice}".`);
    if (relay.choice === "own") this.chooseOwnRelay(relay.address.trim(), relay.token?.trim() || null);
    else this.store.setPushRelay(null, null);
    this.store.setPushesOff(relay.choice === "off");
  }

  private chooseOwnRelay(address: string, token: string | null) {
    const problem = pushRelayAddressProblem(address);
    if (problem) throw new HostProblemError(problem);
    const keepsToken = address === this.store.pushRelaySetting().address && this.store.pushRelaySetting().tokenSet;
    if (!token && !keepsToken) throw new HostProblemError({ code: "push-relay-needs-token" });
    this.store.setPushRelay(address, token);
  }

  private grantRelayInUse() {
    return this.store.pushesOff() ? null : this.grantRelay;
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
    if (!id || notification.machineId || !this.store.pushRegistrations().some(({ registration }) => this.routeTo(registration))) return Promise.resolve();
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
        if (told) this.rememberToldDevices(conversationId!, told);
        const message: PushMessage = { id, sentAt: Date.now(), notification: { kind, conversationId, title, workspace, body } };
        void Promise.all(unshown.map(({ deviceId, registration }) => this.push(deviceId, registration, "alert", message))).then(() => resolve());
      }, this.shownWaitMs),
    );
  }

  /** The conversations that wait for you now; one that phones were told of and that stopped waiting gets cleared on them. */
  waitingChanged(waiting: Set<string>): Promise<void> {
    this.waiting = waiting;
    this.toldOf.forEach((told, conversationId) => {
      if (waiting.has(conversationId)) this.markSeenWaiting(conversationId, told);
    });
    return this.settle([...this.toldOf.keys()].filter((conversationId) => this.toldOf.get(conversationId)!.seenWaiting && !waiting.has(conversationId)));
  }

  /** Conversations whose notifications were read elsewhere, as on a page showing their room: the phones told of one that no longer waits get a clear. */
  read(conversationIds: string[]): Promise<void> {
    return this.settle(conversationIds.filter((conversationId) => this.toldOf.has(conversationId) && !this.waiting.has(conversationId)));
  }

  private settle(conversationIds: string[]) {
    const settled = conversationIds.map((conversationId) => [conversationId, this.toldOf.get(conversationId)!] as const);
    settled.forEach(([conversationId]) => {
      this.toldOf.delete(conversationId);
      this.store.forgetPushTold(conversationId);
    });
    return Promise.all(settled.map(([conversationId, { devices }]) => this.clear(conversationId, devices))).then(() => {});
  }

  /** A notification can come before its conversation shows as waiting, so it counts as settled only once it has waited. */
  private toldOfWaiting(conversationId: string) {
    const told = this.toldOf.get(conversationId) ?? { devices: new Set<string>(), seenWaiting: false };
    if (this.waiting.has(conversationId)) this.markSeenWaiting(conversationId, told);
    this.toldOf.set(conversationId, told);
    return told;
  }

  private markSeenWaiting(conversationId: string, told: ToldOfWaiting) {
    if (told.seenWaiting) return;
    told.seenWaiting = true;
    this.store.markPushToldSeenWaiting(conversationId);
  }

  private rememberToldDevices(conversationId: string, told: ToldOfWaiting) {
    told.devices.forEach((deviceId) => this.store.addPushToldDevice(conversationId, deviceId));
    if (told.seenWaiting) this.store.markPushToldSeenWaiting(conversationId);
  }

  private async clear(conversationId: string, devices: Set<string>) {
    const message: ClearMessage = { id: crypto.randomUUID(), sentAt: Date.now(), cleared: { conversationId } };
    const told = this.store.pushRegistrations().filter(({ deviceId }) => devices.has(deviceId));
    await Promise.all(told.map(({ deviceId, registration }) => this.push(deviceId, registration, "clear", message)));
  }

  private routeTo({ grant }: PushRegistration): PushRoute | null {
    if (this.store.pushesOff()) return null;
    const ownRelay = this.store.pushRelay();
    if (ownRelay) return { ...ownRelay, grant: null };
    return this.grantRelay && grant ? { address: this.grantRelay, token: null, grant } : null;
  }

  private async push(deviceId: string, registration: PushRegistration, kind: Exclude<PushKind, "live-activity-end">, message: PushMessage | ClearMessage) {
    const route = this.routeTo(registration);
    if (!route) return;
    const blob = await sealedPushBlob(registration, message);
    const request: PushRequest = { platform: registration.platform, deviceToken: registration.deviceToken, sandbox: registration.sandbox, kind, blob, ...(route.grant && { grant: route.grant }) };
    const outcome = await this.post(`${route.address.replace(/\/+$/, "")}/push`, {
      method: "POST",
      headers: { ...(route.token && { authorization: `Bearer ${route.token}` }), "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    })
      .then(async (response) => ({ status: response.status, outcome: ((await response.json().catch(() => ({}))) as { outcome?: PushOutcome | "refused" }).outcome }))
      .catch(() => ({ status: 0, outcome: undefined }));
    if (outcome.outcome === "gone") return this.store.deletePushRegistration(deviceId);
    if (outcome.status !== 200) console.warn(`The push relay didn't push to device ${deviceId}: ${outcome.status === 0 ? "no answer" : `${outcome.status} ${outcome.outcome ?? ""}`.trim()}`);
  }
}
