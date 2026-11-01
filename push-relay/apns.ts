import http2, { type ClientHttp2Session, type SecureClientSessionOptions } from "node:http2";
import type { PushOutcome } from "../shared/push.ts";
import { signedJwt, signingKey } from "./signed-tokens.ts";

export const APNS_PRODUCTION = "https://api.push.apple.com";
export const APNS_SANDBOX = "https://api.sandbox.push.apple.com";

/** Apple refuses a provider token re-signed more often than every 20 minutes, and one older than an hour. */
const PROVIDER_TOKEN_KEPT_MS = 40 * 60_000;
const ANSWER_TIMEOUT_MS = 15_000;
/** How long Apple keeps a push for a phone that is off. */
const KEPT_FOR_AN_OFF_PHONE_S = 86_400;

export interface ApnsSettings {
  /** The .p8 key's PEM text. */
  key: string;
  keyId: string;
  teamId: string;
  /** The app's bundle id, such as com.sodre90.mirador. */
  topic: string;
  production?: string;
  sandbox?: string;
  connectOptions?: SecureClientSessionOptions;
  now?: () => number;
}

export type ApnsPush =
  | { kind: "alert" | "clear"; deviceToken: string; sandbox: boolean; blob: string }
  | { kind: "live-activity-end"; deviceToken: string; sandbox: boolean };

interface Answer {
  status: number;
  reason: string | null;
  providerToken: Promise<string>;
}

/** Sends to Apple over one HTTP/2 connection per server, opened again whenever Apple closes it. */
export class Apns {
  private readonly sessions = new Map<string, ClientHttp2Session>();
  private providerToken: { token: Promise<string>; signedAt: number } | null = null;
  private readonly key: Promise<CryptoKey>;
  private readonly now: () => number;

  constructor(private readonly settings: ApnsSettings) {
    this.key = signingKey(settings.key, "ES256");
    this.now = settings.now ?? Date.now;
  }

  async send(push: ApnsPush): Promise<PushOutcome> {
    const first = await this.post(push).catch(() => null);
    const answer = first && !this.needsAnotherTry(first) ? first : await this.post(push).catch(() => null);
    if (!answer) return "failed";
    if (answer.status === 200) return "sent";
    return answer.status === 410 || answer.reason === "Unregistered" || answer.reason === "BadDeviceToken" ? "gone" : "failed";
  }

  close() {
    this.sessions.forEach((session) => session.close());
    this.sessions.clear();
  }

  private needsAnotherTry({ status, reason, providerToken }: Answer) {
    if (reason === "ExpiredProviderToken" && this.providerToken?.token === providerToken) this.providerToken = null;
    return reason === "ExpiredProviderToken" || status === 500 || status === 503;
  }

  private async post(push: ApnsPush): Promise<Answer> {
    const origin = push.sandbox ? (this.settings.sandbox ?? APNS_SANDBOX) : (this.settings.production ?? APNS_PRODUCTION);
    const session = this.sessionTo(origin);
    const providerToken = this.currentProviderToken();
    const request = session.request({
      ":method": "POST",
      ":path": `/3/device/${push.deviceToken}`,
      authorization: `bearer ${await providerToken}`,
      ...this.headersFor(push),
    });
    request.setTimeout(ANSWER_TIMEOUT_MS, () => request.close(http2.constants.NGHTTP2_CANCEL));
    return new Promise((resolve, reject) => {
      let status = 0;
      let body = "";
      request.on("response", (headers) => (status = Number(headers[":status"])));
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => resolve({ status, reason: reasonIn(body), providerToken }));
      request.on("error", reject);
      request.on("close", () => status === 0 && reject(new Error("APNs closed the stream unanswered")));
      request.end(JSON.stringify(this.payloadOf(push)));
    });
  }

  private headersFor(push: ApnsPush) {
    const expiration = String(Math.floor(this.now() / 1000) + KEPT_FOR_AN_OFF_PHONE_S);
    if (push.kind === "alert") return { "apns-push-type": "alert", "apns-topic": this.settings.topic, "apns-priority": "10", "apns-expiration": expiration };
    if (push.kind === "clear") return { "apns-push-type": "background", "apns-topic": this.settings.topic, "apns-priority": "5", "apns-expiration": expiration };
    return { "apns-push-type": "liveactivity", "apns-topic": `${this.settings.topic}.push-type.liveactivity`, "apns-priority": "10", "apns-expiration": expiration };
  }

  /** The alert's own words are only the fallback for a phone that can't decrypt; the phone's extension replaces them with the blob's. */
  private payloadOf(push: ApnsPush) {
    if (push.kind === "alert") return { aps: { alert: { title: "Mirador", body: "Something on your machine needs you" }, "mutable-content": 1, sound: "default" }, m: push.blob };
    if (push.kind === "clear") return { aps: { "content-available": 1 }, m: push.blob };
    const now = Math.floor(this.now() / 1000);
    return { aps: { timestamp: now, event: "end", "content-state": {}, "dismissal-date": now } };
  }

  private sessionTo(origin: string) {
    const open = this.sessions.get(origin);
    if (open && !open.closed && !open.destroyed) return open;
    const session = http2.connect(origin, this.settings.connectOptions);
    const forget = () => this.sessions.get(origin) === session && this.sessions.delete(origin);
    session.on("goaway", forget);
    session.on("close", forget);
    session.on("error", forget);
    this.sessions.set(origin, session);
    return session;
  }

  /** Pushes that arrive together share one signing, since Apple refuses a team that re-signs too often. */
  private currentProviderToken() {
    const now = this.now();
    if (this.providerToken && now - this.providerToken.signedAt < PROVIDER_TOKEN_KEPT_MS) return this.providerToken.token;
    const signing = { token: Promise.resolve(""), signedAt: now };
    signing.token = this.key
      .then((key) => signedJwt(key, "ES256", { kid: this.settings.keyId }, { iss: this.settings.teamId, iat: Math.floor(now / 1000) }))
      .catch((error) => {
        if (this.providerToken === signing) this.providerToken = null;
        throw error;
      });
    this.providerToken = signing;
    return signing.token;
  }
}

function reasonIn(body: string): string | null {
  try {
    return (JSON.parse(body) as { reason?: string }).reason ?? null;
  } catch {
    return null;
  }
}
