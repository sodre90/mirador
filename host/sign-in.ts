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
 * nobody. A page of another port of this computer, such as a dev server, can set a token cookie of its own beside this
 * host's, even one of a device let in here. The host's own token is secret, so beside it the other is ignored; two
 * cookies without it sign in nobody, as either may be the one set by that page. The host's own token signs in only a
 * request from this computer itself: from anywhere else it signs in nobody, as one an agent read and passed on would.
 */
export const signedInWith =
  (browserToken: string, devices: DeviceService, ownerId: string) =>
  (request: Request, fromThisComputer: boolean): SignedIn | null => {
    const tokens = cookieValues(request, TOKEN_COOKIE);
    if (tokens.some((token) => sameSecret(token, browserToken))) return fromThisComputer ? { deviceId: null, personId: ownerId, isOwner: true } : null;
    if (tokens.length !== 1) return null;
    const [token] = tokens;
    const device = token ? devices.deviceWithToken(token) : undefined;
    return device ? { deviceId: device.id, personId: device.personId, isOwner: device.personId === ownerId } : null;
  };
