import { randomBytes } from "node:crypto";
import { commitmentTo, matchingNumber, newNonce, typedNumber, type JoinRequestAnswer, type JoinRequestOpened } from "../shared/join-requests.ts";
import type { JoinRequest } from "../shared/model.ts";
import { deviceName, hashed, type DeviceService } from "./devices.ts";
import type { Store, StoredJoinRequest } from "./store.ts";
import { HostProblemError } from "../shared/host-problems.ts";

const LIFETIME_MILLISECONDS = 5 * 60_000;
const MOST_UNANSWERED = 3;
const MOST_ASKED_PER_SENDER_A_MINUTE = 5;
const SHA256_IN_BASE64URL = /^[\w-]{43}$/;

/** Why the machine refused a request about joining it, with the HTTP status that says so. */
export class JoinRequestRefused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Opening {
  name: unknown;
  commitment: unknown;
  authorityFingerprint: unknown;
  fromAddress: string;
  tailscaleUser: string | null;
}

const shownToApprovers = ({ id, name, fromAddress, tailscaleUser, expiresAt }: StoredJoinRequest): JoinRequest => ({ id, name, fromAddress, tailscaleUser, expiresAt });

/**
 * Devices ask to join this machine instead of typing an invite code, and someone approves them here by typing the
 * number the device shows. Requests are kept in the store, so mirador approve can answer them while the host runs.
 */
export class JoinRequestService {
  constructor(
    private readonly store: Store,
    private readonly devices: DeviceService,
    /** Of the certificate authority this machine serves with; null when it has none of its own. */
    private readonly ownAuthorityFingerprint: string | null,
    private readonly now: () => number = Date.now,
  ) {}

  open({ name, commitment, authorityFingerprint, fromAddress, tailscaleUser }: Opening): JoinRequestOpened {
    if (typeof commitment !== "string" || !SHA256_IN_BASE64URL.test(commitment)) throw new JoinRequestRefused(400, "The request has no commitment to a nonce.");
    const checkedAgainst = (authorityFingerprint ?? null) as string | null;
    if (checkedAgainst !== null && checkedAgainst !== this.ownAuthorityFingerprint) {
      throw new JoinRequestRefused(409, "This machine's certificate authority is not the one you checked its certificate against. Something between you may be posing as it.");
    }
    const now = this.now();
    if (this.store.unansweredJoinRequests(now).length >= MOST_UNANSWERED) {
      throw new JoinRequestRefused(429, "Too many devices are waiting to join this machine. Try again in a few minutes.");
    }
    const secret = randomBytes(32).toString("base64url");
    const request: StoredJoinRequest = {
      id: crypto.randomUUID(),
      secretHash: hashed(secret),
      name: deviceName(name),
      fromAddress,
      tailscaleUser,
      authorityFingerprint: checkedAgainst,
      commitment,
      machineNonce: newNonce(),
      requesterNonce: null,
      answer: null,
      expiresAt: now + LIFETIME_MILLISECONDS,
    };
    this.store.addJoinRequest(request);
    return { id: request.id, secret, machineNonce: request.machineNonce, expiresIn: LIFETIME_MILLISECONDS };
  }

  /** The device asking shows its nonce only once it knows the machine's; from then on the request waits for approval. */
  async reveal(id: string, secret: unknown, nonce: unknown): Promise<JoinRequest> {
    const request = this.askedBy(id, secret);
    if (request.requesterNonce !== null || typeof nonce !== "string" || (await commitmentTo(nonce)) !== request.commitment) {
      throw new JoinRequestRefused(400, "That is not the nonce the request committed to.");
    }
    this.store.setJoinRequestNonce(id, nonce);
    return shownToApprovers(request);
  }

  /** The machine's answer so far; an approved device gets its token here, once. */
  poll(id: string, secret: unknown): JoinRequestAnswer {
    const request = this.askedBy(id, secret);
    if (request.answer === null) return { answer: "waiting" };
    this.store.deleteJoinRequest(id);
    if (request.answer === "denied") return { answer: "denied" };
    const { device, token } = this.devices.admit(request.name);
    return { answer: "approved", deviceId: device.id, token };
  }

  waiting(): JoinRequest[] {
    return this.store
      .unansweredJoinRequests(this.now())
      .filter(({ requesterNonce }) => requesterNonce !== null)
      .map(shownToApprovers);
  }

  /** Approves the request when the number typed is the one its device shows, and otherwise denies it; whether it approved it. */
  async approve(id: string, typed: string) {
    const request = this.waitingRequest(id);
    const approved = typedNumber(typed) === (await matchingNumber(request.authorityFingerprint, request.requesterNonce!, request.machineNonce));
    if (!this.store.answerJoinRequest(id, approved ? "approved" : "denied")) throw new HostProblemError({ code: "join-request-no-longer-waiting" });
    return approved;
  }

  deny(id: string) {
    this.waitingRequest(id);
    this.store.answerJoinRequest(id, "denied");
  }

  private askedBy(id: string, secret: unknown) {
    const request = this.store.findJoinRequest(id, this.now());
    if (!request || typeof secret !== "string" || hashed(secret) !== request.secretHash) {
      throw new JoinRequestRefused(404, "This request to join expired, or was never made.");
    }
    return request;
  }

  private waitingRequest(id: string) {
    const request = this.store.findJoinRequest(id, this.now());
    if (!request || request.requesterNonce === null || request.answer !== null) throw new HostProblemError({ code: "join-request-no-longer-waiting" });
    return request;
  }
}

/** Keeps one sender from filling the few places for waiting requests. */
export class SenderLimit {
  private readonly askedAt = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  allows(sender: string) {
    const aMinuteAgo = this.now() - 60_000;
    this.askedAt.forEach((times, someSender) => {
      const recent = times.filter((at) => at > aMinuteAgo);
      if (recent.length > 0) this.askedAt.set(someSender, recent);
      else this.askedAt.delete(someSender);
    });
    const recent = this.askedAt.get(sender) ?? [];
    if (recent.length >= MOST_ASKED_PER_SENDER_A_MINUTE) return false;
    this.askedAt.set(sender, [...recent, this.now()]);
    return true;
  }
}
