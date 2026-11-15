import { createHmac, timingSafeEqual } from "node:crypto";
import { PUSH_GRANT_PATTERN, type PushPlatform } from "../shared/push.ts";

/** Long enough that a phone renewing weekly never runs out, short enough that a grant for a token Apple or Google retired stops working on its own. */
export const GRANT_LIFETIME_S = 30 * 24 * 3600;
/** The secret's shortest length, so its MACs can't be guessed. */
const SHORTEST_SECRET = 32;

export interface GrantedDevice {
  platform: PushPlatform;
  sandbox: boolean;
  deviceToken: string;
}

/** Makes and checks grants with the relay's secret alone, so the relay keeps no list of them. */
export class Grants {
  private readonly secret: Buffer;

  constructor(
    secret: string,
    private readonly now: () => number = Date.now,
  ) {
    if (secret.length < SHORTEST_SECRET) throw new Error(`The grant secret needs at least ${SHORTEST_SECRET} characters.`);
    this.secret = Buffer.from(secret);
  }

  issue(device: GrantedDevice) {
    const expiresAt = Math.floor(this.now() / 1000) + GRANT_LIFETIME_S;
    return `${expiresAt}.${this.macOf(device, expiresAt)}`;
  }

  allows(grant: string, device: GrantedDevice) {
    if (!PUSH_GRANT_PATTERN.test(grant)) return false;
    const [expiresAt, mac] = grant.split(".");
    if (Number(expiresAt) * 1000 <= this.now()) return false;
    const expected = Buffer.from(this.macOf(device, Number(expiresAt)));
    const presented = Buffer.from(mac);
    return expected.length === presented.length && timingSafeEqual(expected, presented);
  }

  private macOf({ platform, sandbox, deviceToken }: GrantedDevice, expiresAt: number) {
    const signed = ["mirador-push-grant-1", platform, sandbox ? "sandbox" : "production", deviceToken, String(expiresAt)].join("\n");
    return createHmac("sha256", this.secret).update(signed).digest("base64url");
  }
}
