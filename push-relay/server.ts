import { DEVICE_TOKEN_PATTERNS, PUSH_BLOB_BYTES, type PushOutcome, type PushRequest } from "../shared/push.ts";
import type { ApnsPush } from "./apns.ts";
import type { FcmPush } from "./fcm.ts";
import { hostOf } from "./host-tokens.ts";

/** The largest body a valid request can be, with room for the JSON around the blob and the longest device token. */
export const LONGEST_BODY = 4096;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface Senders {
  apns: { send(push: ApnsPush): Promise<PushOutcome> } | null;
  fcm: { send(push: FcmPush): Promise<PushOutcome> } | null;
}

export interface RelaySettings {
  tokensFile: string;
  senders: Senders;
  /** Pushes a Mac may send in a minute, so a leaked token can't flood a phone or spend the relay's standing with Apple and Google. */
  perMinute?: number;
  now?: () => number;
}

const answer = (status: number, outcome: PushOutcome | "refused") => Response.json({ outcome }, { status });

/** Handles POST /push from Macs with a token; it never logs tokens, device tokens or blobs, and it can't read the blobs. */
export function relayHandler({ tokensFile, senders, perMinute = 120, now = Date.now }: RelaySettings) {
  const recentPushes = new Map<string, number[]>();

  const withinRate = (host: string) => {
    const since = now() - 60_000;
    const recent = (recentPushes.get(host) ?? []).filter((at) => at > since);
    if (recent.length >= perMinute) return false;
    recentPushes.set(host, [...recent, now()]);
    return true;
  };

  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") return new Response("ok");
    if (pathname !== "/push" || request.method !== "POST") return new Response(null, { status: 404 });
    const presented = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
    const host = presented ? hostOf(tokensFile, presented) : null;
    if (!host) return answer(401, "refused");
    if (Number(request.headers.get("content-length") ?? 0) > LONGEST_BODY) return answer(413, "refused");
    const body = await request.text().catch(() => "");
    if (body.length > LONGEST_BODY) return answer(413, "refused");
    const push = validPush(body);
    if (!push) return answer(400, "refused");
    if (!withinRate(host)) return answer(429, "refused");
    const outcome = await sent(push, senders);
    return answer(outcome === "sent" ? 200 : outcome === "gone" ? 410 : 502, outcome);
  };
}

async function sent(push: PushRequest, { apns, fcm }: Senders): Promise<PushOutcome> {
  const { deviceToken, kind, blob } = push;
  if (push.platform === "android") return fcm && kind !== "live-activity-end" ? fcm.send({ kind, deviceToken, blob: blob! }) : "failed";
  if (!apns) return "failed";
  const sandbox = push.sandbox === true;
  return kind === "live-activity-end" ? apns.send({ kind, deviceToken, sandbox }) : apns.send({ kind, deviceToken, sandbox, blob: blob! });
}

function validPush(body: string): PushRequest | null {
  let push: PushRequest;
  try {
    push = JSON.parse(body) as PushRequest;
  } catch {
    return null;
  }
  if (typeof push !== "object" || push === null) return null;
  const { platform, deviceToken, kind, blob, sandbox } = push;
  if (sandbox !== undefined && typeof sandbox !== "boolean") return null;
  if (platform !== "ios" && platform !== "android") return null;
  if (typeof deviceToken !== "string" || !DEVICE_TOKEN_PATTERNS[platform].test(deviceToken)) return null;
  if (kind === "alert" || kind === "clear") return isFullBlob(blob) ? push : null;
  if (platform === "android") return null;
  return kind === "live-activity-end" && blob === undefined ? push : null;
}

const isFullBlob = (blob: unknown) => typeof blob === "string" && BASE64.test(blob) && Buffer.from(blob, "base64").length === PUSH_BLOB_BYTES;
