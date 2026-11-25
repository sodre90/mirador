import { createHash, randomBytes, randomInt } from "node:crypto";
import { INVITE_ALPHABET } from "../shared/machines.ts";
import type { Device } from "../shared/model.ts";
import { oneLine, shownAsWritten } from "../shared/written-text.ts";
import type { Store } from "./store.ts";

const DEVICE_INVITE_LIFETIME_MILLISECONDS = 15 * 60_000;
const INVITE_LENGTH = 12;
const DEVICE_NAME_LENGTH = 80;

export const hashed = (secret: string) => createHash("sha256").update(secret).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const withoutSeparators = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
/** The same for every way an invite code is written, and kept instead of the code. */
export const inviteKey = (code: string) => hashed(withoutSeparators(code));
const inGroupsOfFour = (code: string) => code.match(/.{1,4}/g)!.join("-");

/** No device invite's code holds an O, so a code that starts with these letters is a room invite's wherever it is typed. */
const ROOM_INVITE_MARK = "ROOM";

export const isRoomInviteCode = (code: string) => withoutSeparators(code).startsWith(ROOM_INVITE_MARK);

export interface Invite {
  code: string;
  expiresAt: number;
}

/** A new invite's code, as it is shown, and when it stops working. */
function newInvite(now: number, lifetimeMilliseconds: number): Invite {
  const code = Array.from({ length: INVITE_LENGTH }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join("");
  return { code: inGroupsOfFour(code), expiresAt: now + lifetimeMilliseconds };
}

export function newRoomInvite(now: number, lifetimeMilliseconds: number): Invite {
  const { code, expiresAt } = newInvite(now, lifetimeMilliseconds);
  return { code: `${ROOM_INVITE_MARK}-${code}`, expiresAt };
}

/** On one line and as everyone reads it, like a person's name, as the device that sent it is not trusted yet. */
export function deviceName(name: unknown) {
  const shown = typeof name === "string" ? oneLine(shownAsWritten(name)).slice(0, DEVICE_NAME_LENGTH).trim() : "";
  return shown || "Unnamed device";
}

/** Other browsers and apps join this machine with a one-time invite code; each then signs in with a token of its own, until revoked. */
export class DeviceService {
  constructor(
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {}

  invite(): Invite {
    const invite = newInvite(this.now(), DEVICE_INVITE_LIFETIME_MILLISECONDS);
    this.store.addInvite(inviteKey(invite.code), invite.expiresAt);
    return invite;
  }

  /** Uses the invite up and gives the new device its token; null if the code is wrong, used or expired. */
  join(code: string, name: string) {
    return this.store.takeInvite(inviteKey(code), this.now()) ? this.admit(name, this.store.ownerId()) : null;
  }

  /** Lets a new device of the person's in, with the token it signs in with from now on; only its hash is kept. */
  admit(name: string, personId: string): { device: Device; token: string } {
    const now = this.now();
    const token = newToken();
    const device = { id: crypto.randomUUID(), name, personId, joinedAt: now, lastSeenAt: now };
    this.store.insertDevice(device, hashed(token));
    return { device, token };
  }

  /** A device that never got the token it was admitted with gets another, and the first stops working; null if the device is gone. */
  reissueToken(deviceId: string) {
    const token = newToken();
    return this.store.setDeviceTokenHash(deviceId, hashed(token)) ? token : null;
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
