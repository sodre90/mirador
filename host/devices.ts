import { createHash, randomBytes, randomInt } from "node:crypto";
import type { Device } from "../shared/model.ts";
import type { Store } from "./store.ts";

const INVITE_LIFETIME_MILLISECONDS = 15 * 60_000;
/** Letters and digits nobody mistakes for one another when reading a code out or typing it. */
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const INVITE_LENGTH = 12;
const DEVICE_NAME_LENGTH = 80;

export const hashed = (secret: string) => createHash("sha256").update(secret).digest("hex");
const withoutSeparators = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
/** The same for every way an invite code is written, and kept instead of the code. */
export const inviteKey = (code: string) => hashed(withoutSeparators(code));
const inGroupsOfFour = (code: string) => code.match(/.{1,4}/g)!.join("-");

export interface Invite {
  code: string;
  expiresAt: number;
}

export const deviceName = (name: unknown) => (typeof name === "string" && name.trim() ? name.trim().slice(0, DEVICE_NAME_LENGTH) : "Unnamed device");

/** Other browsers and apps join this machine with a one-time invite code; each then signs in with a token of its own, until revoked. */
export class DeviceService {
  constructor(
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {}

  invite(): Invite {
    const code = Array.from({ length: INVITE_LENGTH }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join("");
    const expiresAt = this.now() + INVITE_LIFETIME_MILLISECONDS;
    this.store.addInvite(inviteKey(code), expiresAt);
    return { code: inGroupsOfFour(code), expiresAt };
  }

  /** Uses the invite up and gives the new device its token; null if the code is wrong, used or expired. */
  join(code: string, name: string) {
    return this.store.takeInvite(inviteKey(code), this.now()) ? this.admit(name) : null;
  }

  /** Lets a new device in, with the token it signs in with from now on; only its hash is kept. */
  admit(name: string): { device: Device; token: string } {
    const now = this.now();
    const token = randomBytes(32).toString("base64url");
    const device = { id: crypto.randomUUID(), name, joinedAt: now, lastSeenAt: now };
    this.store.insertDevice(device, hashed(token));
    return { device, token };
  }

  deviceWithToken(token: string) {
    return this.store.findDeviceByTokenHash(hashed(token));
  }

  list() {
    return this.store.listDevices();
  }

  revoke(deviceId: string) {
    this.store.deleteDevice(deviceId);
  }

  seen(deviceId: string) {
    this.store.setDeviceLastSeen(deviceId, this.now());
  }
}
