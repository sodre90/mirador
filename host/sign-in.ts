import { timingSafeEqual } from "node:crypto";
import { TOKEN_COOKIE } from "../shared/protocol.ts";
import type { DeviceService } from "./devices.ts";
import type { SignedIn } from "./hub.ts";

export function sameSecret(candidate: string | null | undefined, secret: string) {
  if (!candidate) return false;
  const [a, b] = [Buffer.from(candidate), Buffer.from(secret)];
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  return cookies
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];
}

const cookieValues = (request: Request, name: string) =>
  (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .filter(([key]) => key === name)
    .map(([, value]) => value);

/**
 * Whom a request's cookie signs in: the owner through the host's own link (no device), a joined device's person, or
 * nobody. A page of another port of this computer, such as a machine's relay, can set a token cookie of its own beside
 * this host's, so a request with two signs in nobody.
 */
export const signedInWith =
  (browserToken: string, devices: DeviceService, ownerId: string) =>
  (request: Request): SignedIn | null => {
    const tokens = cookieValues(request, TOKEN_COOKIE);
    if (tokens.length !== 1) return null;
    const [token] = tokens;
    if (sameSecret(token, browserToken)) return { deviceId: null, personId: ownerId, isOwner: true };
    const device = token ? devices.deviceWithToken(token) : undefined;
    return device ? { deviceId: device.id, personId: device.personId, isOwner: device.personId === ownerId } : null;
  };
