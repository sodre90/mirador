import type { PushOutcome } from "../shared/push.ts";
import { signedJwt, signingKey } from "./signed-tokens.ts";

const FCM_ORIGIN = "https://fcm.googleapis.com";
const MESSAGING_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const ASSERTION_LIFETIME_S = 3600;
/** An access token is used until this close to its expiry, then replaced. */
const RENEWED_BEFORE_EXPIRY_MS = 5 * 60_000;
const ANSWER_TIMEOUT_MS = 15_000;
/** How long Google keeps a push for a phone that is off, the same day Apple keeps one. */
const KEPT_FOR_AN_OFF_PHONE = "86400s";

/** A clear goes at normal priority: Google lowers an app's high priority when its messages show nothing, which would slow its alerts. */
export interface FcmPush {
  kind: "alert" | "clear";
  deviceToken: string;
  blob: string;
}

/** The fields Mirador reads from the Firebase service account's JSON key. */
export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

export interface FcmSettings {
  account: ServiceAccount;
  origin?: string;
  now?: () => number;
}

/** Sends data messages, which the app decrypts itself, with an access token from the service account's signed assertion. */
export class Fcm {
  /** expiresAt is null while Google hasn't answered yet. */
  private accessToken: { token: Promise<string>; expiresAt: number | null } | null = null;
  private readonly key: Promise<CryptoKey>;
  private readonly now: () => number;

  constructor(private readonly settings: FcmSettings) {
    this.key = signingKey(settings.account.private_key, "RS256");
    this.now = settings.now ?? Date.now;
  }

  async send(push: FcmPush): Promise<PushOutcome> {
    const first = await this.post(push).catch(() => null);
    const answer = first?.status === 401 ? await this.post(push, { renewed: true }).catch(() => null) : first;
    if (!answer) return "failed";
    if (answer.ok) return "sent";
    return answer.status === 404 || answer.errorCode === "UNREGISTERED" ? "gone" : "failed";
  }

  private async post({ kind, deviceToken, blob }: FcmPush, { renewed = false } = {}) {
    if (renewed) this.accessToken = null;
    const response = await fetch(`${this.settings.origin ?? FCM_ORIGIN}/v1/projects/${this.settings.account.project_id}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${await this.currentAccessToken()}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { token: deviceToken, data: { m: blob }, android: { priority: kind === "alert" ? "high" : "normal", ttl: KEPT_FOR_AN_OFF_PHONE } } }),
      signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS),
    });
    return { ok: response.ok, status: response.status, errorCode: response.ok ? null : await errorCodeIn(response) };
  }

  /** Pushes that arrive together wait for one access token rather than each asking Google. */
  private currentAccessToken() {
    const held = this.accessToken;
    if (held && (held.expiresAt === null || this.now() < held.expiresAt - RENEWED_BEFORE_EXPIRY_MS)) return held.token;
    const asking: { token: Promise<string>; expiresAt: number | null } = { token: Promise.resolve(""), expiresAt: null };
    asking.token = this.newAccessToken().then(
      ({ token, expiresAt }) => ((asking.expiresAt = expiresAt), token),
      (error) => {
        if (this.accessToken === asking) this.accessToken = null;
        throw error;
      },
    );
    this.accessToken = asking;
    return asking.token;
  }

  private async newAccessToken() {
    const now = this.now();
    const { client_email, token_uri } = this.settings.account;
    const issuedAt = Math.floor(now / 1000);
    const assertion = await signedJwt(await this.key, "RS256", { typ: "JWT" }, { iss: client_email, scope: MESSAGING_SCOPE, aud: token_uri, iat: issuedAt, exp: issuedAt + ASSERTION_LIFETIME_S });
    const response = await fetch(token_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Google refused the service account's assertion with ${response.status}`);
    const { access_token, expires_in } = (await response.json()) as { access_token: string; expires_in: number };
    return { token: access_token, expiresAt: now + expires_in * 1000 };
  }
}

/** FCM v1 puts its own error code in the details of a google.rpc.Status. */
async function errorCodeIn(response: Response): Promise<string | null> {
  try {
    const { error } = (await response.json()) as { error?: { details?: { errorCode?: string }[] } };
    return error?.details?.find((detail) => detail.errorCode)?.errorCode ?? null;
  } catch {
    return null;
  }
}
