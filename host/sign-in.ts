import { timingSafeEqual } from "node:crypto";
import { TOKEN_COOKIE } from "../shared/protocol.ts";
import type { DeviceService } from "./devices.ts";

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

/** Whom a request's cookie signs in: the host's own link (no device), a joined device, or nobody. */
export const signedInWith =
  (browserToken: string, devices: DeviceService) =>
  (request: Request): { deviceId: string | null } | null => {
    const token = cookieValue(request, TOKEN_COOKIE);
    if (sameSecret(token, browserToken)) return { deviceId: null };
    const device = token ? devices.deviceWithToken(token) : undefined;
    return device ? { deviceId: device.id } : null;
  };
