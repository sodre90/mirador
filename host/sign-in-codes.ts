import { randomBytes } from "node:crypto";
import { hashed } from "./devices.ts";
import type { Store } from "./store.ts";

const SIGN_IN_CODE_LIFETIME_MILLISECONDS = 10 * 60_000;
export const SIGN_IN_CODE_LIFETIME_MINUTES = SIGN_IN_CODE_LIFETIME_MILLISECONDS / 60_000;

export const signInLink = (appOrigin: string, code: string) => `${appOrigin}/auth?code=${code}`;

/**
 * One-time codes this machine's own browsers sign in with, so the long-lived browser token never sits in a link that
 * browser history, terminal scrollback or a log keeps.
 */
export class SignInCodes {
  constructor(
    private readonly store: Store,
    private readonly now: () => number = Date.now,
  ) {}

  mint() {
    const code = randomBytes(24).toString("base64url");
    this.store.addSignInCode(hashed(code), this.now() + SIGN_IN_CODE_LIFETIME_MILLISECONDS);
    return code;
  }

  /** Uses the code up; whether it was one still valid. */
  redeem(code: string) {
    return this.store.takeSignInCode(hashed(code), this.now());
  }
}
