import { DEVICE_TOKEN_PATTERNS, GRANT_REQUEST_ID_PATTERN, PUSH_BLOB_BYTES, PUSH_GRANT_PATTERN, type PushGrantRequest, type PushOutcome, type PushRequest } from "../shared/push.ts";
import type { ApnsPush } from "./apns.ts";
import type { FcmPush } from "./fcm.ts";
import type { Grants } from "./grants.ts";
import { hostOf } from "./host-tokens.ts";
import { RateLimit } from "./rate-limit.ts";

/** The largest body a valid request can be, with room for the JSON around the blob, the longest device token and a grant. */
export const LONGEST_BODY = 4096;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface Senders {
  apns: { send(push: ApnsPush): Promise<PushOutcome> } | null;
  fcm: { send(push: FcmPush): Promise<PushOutcome> } | null;
}

export interface RelaySettings {
  tokensFile: string;
  senders: Senders;
  /** Makes the grants phones ask for and checks the ones Macs push with; without it the relay takes Macs' own tokens alone. */
  grants?: Grants | null;
  /** The header the proxy in front of the relay names the asking address in; without one, the connection's own address counts. */
  clientAddressHeader?: string;
  /** Pushes a Mac, or a phone's grant, may send in a minute, so a leaked token or grant can't flood a phone or spend the relay's standing with Apple and Google. */
  perMinute?: number;
  /** Grants one address may ask for in an hour: generous, as phones on a mobile network share addresses. */
  grantAsksPerHour?: number;
  /** Grants one device token may be pushed in a day: a phone renews weekly, and retries hourly at most while one doesn't arrive. */
  grantsPerDay?: number;
  now?: () => number;
}

const answer = (status: number, outcome: PushOutcome | "refused") => Response.json({ outcome }, { status });
const statusOf = (outcome: PushOutcome, sent = 200) => (outcome === "sent" ? sent : outcome === "gone" ? 410 : 502);

/**
 * Handles POST /push from Macs, with their own token or a phone's grant, and POST /grant from phones; it never logs
 * tokens, device tokens, grants or blobs, and it can't read the blobs.
 */
export function relayHandler({ tokensFile, senders, grants = null, clientAddressHeader, perMinute = 120, grantAsksPerHour = 60, grantsPerDay = 6, now = Date.now }: RelaySettings) {
  const pushesPerMinute = new RateLimit(perMinute, MINUTE_MS, now);
  const grantAsksPerAddress = new RateLimit(grantAsksPerHour, HOUR_MS, now);
  const grantsPerToken = new RateLimit(grantsPerDay, DAY_MS, now);

  const pushed = async (request: Request) => {
    const presented = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
    const host = presented ? hostOf(tokensFile, presented) : null;
    if (presented && !host) return answer(401, "refused");
    const body = await bodyOf(request);
    if (body === null) return answer(413, "refused");
    const push = validPush(body);
    if (!push) return answer(400, "refused");
    const sender = host ? `mac ${host}` : grantHolder(push);
    if (!sender) return answer(401, "refused");
    if (!pushesPerMinute.allows(sender)) return answer(429, "refused");
    const outcome = await sent(push, senders);
    return answer(statusOf(outcome), outcome);
  };

  const grantHolder = (push: PushRequest) => {
    const device = { platform: push.platform, sandbox: push.platform === "ios" && push.sandbox === true, deviceToken: push.deviceToken };
    const granted = push.grant !== undefined && push.kind !== "live-activity-end" && grants?.allows(push.grant, device);
    return granted ? `phone ${push.platform} ${push.deviceToken}` : null;
  };

  const granted = async (request: Request, grants: Grants, connectionAddress: string | null) => {
    const body = await bodyOf(request);
    if (body === null) return answer(413, "refused");
    const ask = validGrantRequest(body);
    if (!ask) return answer(400, "refused");
    const address = (clientAddressHeader && request.headers.get(clientAddressHeader)?.split(",").at(-1)?.trim()) || connectionAddress || "unknown";
    if (!grantAsksPerAddress.allows(address) || !grantsPerToken.allows(`${ask.platform} ${ask.deviceToken}`)) return answer(429, "refused");
    const grant = grants.issue(ask);
    const outcome = await sentGrant(ask, grant, senders);
    return answer(statusOf(outcome, 202), outcome);
  };

  return async (request: Request, connectionAddress: string | null = null): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") return new Response("ok");
    if (request.method === "POST" && pathname === "/push") return pushed(request);
    if (request.method === "POST" && pathname === "/grant" && grants) return granted(request, grants, connectionAddress);
    return new Response(null, { status: 404 });
  };
}

/** The body, or null when it is longer than any valid request. */
async function bodyOf(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > LONGEST_BODY) return null;
  const body = await request.text().catch(() => "");
  return body.length > LONGEST_BODY ? null : body;
}

async function sent(push: PushRequest, { apns, fcm }: Senders): Promise<PushOutcome> {
  const { deviceToken, kind, blob } = push;
  if (push.platform === "android") return fcm && kind !== "live-activity-end" ? fcm.send({ kind, deviceToken, blob: blob! }) : "failed";
  if (!apns) return "failed";
  const sandbox = push.sandbox === true;
  return kind === "live-activity-end" ? apns.send({ kind, deviceToken, sandbox }) : apns.send({ kind, deviceToken, sandbox, blob: blob! });
}

/** The grant goes to the token it was made for, so only the phone holding that token gets it. */
async function sentGrant({ platform, deviceToken, sandbox, requestId }: PushGrantRequest, grant: string, { apns, fcm }: Senders): Promise<PushOutcome> {
  if (platform === "android") return fcm ? fcm.send({ kind: "grant", deviceToken, grant, requestId }) : "failed";
  return apns ? apns.send({ kind: "grant", deviceToken, sandbox, grant, requestId }) : "failed";
}

function parsedObject(body: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function validPush(body: string): PushRequest | null {
  const push = parsedObject(body) as PushRequest | null;
  if (!push) return null;
  const { platform, deviceToken, kind, blob, sandbox, grant } = push;
  if (sandbox !== undefined && typeof sandbox !== "boolean") return null;
  if (grant !== undefined && (typeof grant !== "string" || !PUSH_GRANT_PATTERN.test(grant))) return null;
  if (platform !== "ios" && platform !== "android") return null;
  if (typeof deviceToken !== "string" || !DEVICE_TOKEN_PATTERNS[platform].test(deviceToken)) return null;
  if (kind === "alert" || kind === "clear") return isFullBlob(blob) ? push : null;
  if (platform === "android") return null;
  return kind === "live-activity-end" && blob === undefined ? push : null;
}

/** Android phones aren't served from a sandbox, so theirs is always false. */
function validGrantRequest(body: string): PushGrantRequest | null {
  const ask = parsedObject(body);
  if (!ask) return null;
  const { platform, deviceToken, sandbox, requestId } = ask;
  if (platform !== "ios" && platform !== "android") return null;
  if (typeof deviceToken !== "string" || !DEVICE_TOKEN_PATTERNS[platform].test(deviceToken)) return null;
  if (typeof sandbox !== "boolean" || typeof requestId !== "string" || !GRANT_REQUEST_ID_PATTERN.test(requestId)) return null;
  return { platform, deviceToken, sandbox: platform === "ios" && sandbox, requestId };
}

const isFullBlob = (blob: unknown) => typeof blob === "string" && BASE64.test(blob) && Buffer.from(blob, "base64").length === PUSH_BLOB_BYTES;
