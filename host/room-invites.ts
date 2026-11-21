import { HostProblemError } from "../shared/host-problems.ts";
import { isPastel, type Device, type Pastel } from "../shared/model.ts";
import { NAMES_KEPT_BY_MIRADOR, nameRefused, nameTaken, personName } from "../shared/people.ts";
import { isRoomRole, type RoomInvite, type RoomRole } from "../shared/rooms.ts";
import { shownAsWritten } from "../shared/written-text.ts";
import type { InviteTunnel } from "../shared/tunnel.ts";
import { inviteKey, newRoomInvite, type DeviceService } from "./devices.ts";
import { isChallenge, newChallenge, NO_AUTHORITY, signedRoomJoin, type ReachedAt } from "./person-keys.ts";
import { namesOthersGoBy } from "./person-view.ts";
import type { PeerToPeer, TunnelEnd } from "./p2p/service.ts";
import type { Store } from "./store.ts";

const CHALLENGE_LIFETIME_MILLISECONDS = 2 * 60_000;
/** Far longer than a name the rules keep, so a longer one is turned away before they read it all. */
const LONGEST_PRESENTED_NAME = 400;

export type { ReachedAt } from "./person-keys.ts";

interface Challenge {
  inviteId: string;
  /** How the joiner asked for it, which its signature must name and its join must come the same way. */
  reachedAt: ReachedAt;
  expiresAt: number;
}

/**
 * How a request reached this machine, from what the server itself knows of it and never from what the request says of
 * itself: through the tunnel end of the invite the code is for, by this machine's own tunnel key, which the joiner's
 * handshake proved it holds; at an address, the host and port the request named and the fingerprint of this machine's
 * own certificate authority if it served that request a certificate of its own, else NO_AUTHORITY. This machine serves
 * its own certificate only over HTTPS of its own; a proxy in front of it, such as tailscale serve, reaches it over HTTP.
 * Null where no room invite joins: through any other tunnel end, a device's own one or another invite's.
 */
export function reachedAt(request: Request, code: string, own: { authorityFingerprint: string | null; tunnelKey: string | null }, end: TunnelEnd | undefined): ReachedAt | null {
  if (end) return "inviteKey" in end && end.inviteKey === inviteKey(code) && own.tunnelKey ? { tunnelKey: own.tunnelKey } : null;
  return {
    host: request.headers.get("host") ?? "",
    authorityFingerprint: (new URL(request.url).protocol === "https:" && own.authorityFingerprint) || NO_AUTHORITY,
  };
}

const sameReach = (one: ReachedAt, other: ReachedAt) =>
  "tunnelKey" in one ? "tunnelKey" in other && one.tunnelKey === other.tunnelKey : "host" in other && one.host === other.host && one.authorityFingerprint === other.authorityFingerprint;

/** What came of a room invite: a device of a person other than the owner, and the room it let them into. */
export interface Admitted {
  device: Device;
  token: string;
  personId: string;
  roomId: string;
}

/**
 * Invites into a room, each for one person with one role, kept apart from device invites: only a waiting room invite's
 * code gets a challenge or admits anyone here, and what it admits is always a person other than the owner. The person
 * proves the key they present by signing the challenge, the invite, and how they reached this machine: its address and
 * the certificate authority they trusted it by, or its key in the peer-to-peer tunnel. So a signature made for another
 * invite or machine, passed on by someone in between, asked for one way and used another, or used once already, admits
 * nobody. A proof that fails and one with the owner's key are turned away alike.
 */
export class RoomInvites {
  private readonly challenges = new Map<string, Challenge>();

  constructor(
    private readonly store: Store,
    private readonly devices: DeviceService,
    /** This machine's own owner's, which no invite admits as a person. */
    private readonly ownersPublicKey: string,
    private readonly now: () => number = Date.now,
  ) {}

  invite(roomId: string, role: RoomRole): { invite: RoomInvite; code: string } {
    if (!this.store.findRoom(roomId)) throw new HostProblemError({ code: "room-gone" });
    if (!isRoomRole(role)) throw new Error(`There is no room role "${role}".`);
    const { code, expiresAt } = newRoomInvite(this.now());
    const invite = { id: crypto.randomUUID(), roomId, role, expiresAt };
    this.store.addRoomInvite(invite, inviteKey(code));
    return { invite, code };
  }

  waiting(): RoomInvite[] {
    return this.store.waitingRoomInvites(this.now());
  }

  /** The withdrawn invite's code as `inviteKey` keeps it, for its one-time key in the tunnel to go too; null when it was gone already. */
  withdraw(inviteId: string): string | null {
    const codeKey = this.store.deleteRoomInvite(inviteId);
    this.forgetChallengesFor(inviteId);
    return codeKey;
  }

  /** Every invite into the room, as the room goes: their codes as `inviteKey` keeps them, for their one-time keys in the tunnel to go too. */
  withdrawAllInto(roomId: string): string[] {
    const withdrawn = this.store.deleteRoomInvitesInto(roomId);
    withdrawn.forEach(({ id }) => this.forgetChallengesFor(id));
    return withdrawn.map(({ codeKey }) => codeKey);
  }

  waitsFor(code: string) {
    return this.store.findRoomInvite(inviteKey(code), this.now()) !== undefined;
  }

  /**
   * The way into this host's tunnel the invite with `code` carries, when peer to peer is ready. An invite withdrawn
   * meanwhile keeps none, and one whose way in could not be made goes out without it.
   */
  async tunnelFor(code: string, expiresAt: number, p2p: Pick<PeerToPeer, "invite" | "inviteWithdrawn"> | null): Promise<InviteTunnel | null> {
    const tunnel = await (p2p?.invite(code, expiresAt) ?? Promise.resolve(null)).catch((error: unknown) => {
      console.error(`a room invite goes out without a way through the tunnel: ${error instanceof Error ? error.message : String(error)}`);
      p2p?.inviteWithdrawn(inviteKey(code));
      return null;
    });
    if (!tunnel || this.waitsFor(code)) return tunnel;
    p2p?.inviteWithdrawn(inviteKey(code));
    return null;
  }

  /** A challenge for whoever holds a waiting room invite's code to sign; the newest for an invite replaces the one before. Null for any other code. */
  challenge(code: string, reached: ReachedAt): string | null {
    const invite = this.store.findRoomInvite(inviteKey(code), this.now());
    if (!invite) return null;
    this.forgetChallengesFor(invite.id);
    const challenge = newChallenge();
    this.challenges.set(challenge, { inviteId: invite.id, reachedAt: reached, expiresAt: this.now() + CHALLENGE_LIFETIME_MILLISECONDS });
    return challenge;
  }

  /**
   * Uses the invite up for the person whose key signed the challenge made for it, reached as `reached`: the same key is the same
   * person, who gains the room, and a new key a new person. Their device, their place in the room with the invite's role
   * and the name they presented are made in one go. The challenge is used up whatever comes of it.
   */
  redeem(code: string, deviceName: string, presented: unknown, reached: ReachedAt): Admitted {
    const { publicKey, name, color, challenge, signature } = (typeof presented === "object" && presented !== null ? presented : {}) as Record<string, unknown>;
    const asked = isChallenge(challenge) ? this.takeChallenge(challenge) : undefined;
    const codeKey = inviteKey(code);
    const invite = this.store.findRoomInvite(codeKey, this.now());
    if (!invite) throw new HostProblemError({ code: "invite-code-wrong" });
    const proven =
      isChallenge(challenge) &&
      asked?.inviteId === invite.id &&
      sameReach(asked.reachedAt, reached) &&
      typeof publicKey === "string" &&
      signedRoomJoin({ challenge, inviteKey: codeKey, ...reached, publicKey }, signature);
    if (!proven || publicKey === this.ownersPublicKey) throw new HostProblemError({ code: "room-join-unproven" });
    return this.store.inOneTransaction(() => {
      const taken = this.store.takeRoomInvite(codeKey, this.now());
      if (!taken) throw new HostProblemError({ code: "invite-code-wrong" });
      const personId = this.personWithKey(publicKey);
      this.store.setRoomPersonRole(taken.roomId, personId, taken.role);
      this.namePerson(taken.roomId, personId, name, isPastel(color) ? color : null);
      return { ...this.devices.admit(deviceName, personId), personId, roomId: taken.roomId };
    });
  }

  private personWithKey(publicKey: string) {
    const known = this.store.personWithKey(publicKey);
    if (known) return known;
    const personId = crypto.randomUUID();
    this.store.insertPerson({ id: personId, name: "", color: null });
    this.store.addPersonKey(publicKey, personId);
    return personId;
  }

  /**
   * By the name they presented, unless the name rules refuse it or it reads as one Mirador says; then without one. A name
   * that reads as one already in their rooms leaves them without one too, and the owner sees it beside them in the room.
   */
  private namePerson(roomId: string, personId: string, presented: unknown, color: Pastel | null) {
    const named = typeof presented === "string" && presented.length <= LONGEST_PRESENTED_NAME && !nameRefused(presented) ? personName(shownAsWritten(presented)) : "";
    const keptByMirador = nameTaken(named, NAMES_KEPT_BY_MIRADOR);
    const clashes = !keptByMirador && nameTaken(named, namesOthersGoBy(this.store, personId));
    this.store.setPersonProfile(personId, { name: keptByMirador || clashes ? "" : named, color });
    this.store.forgetNameClashesOf(personId);
    if (clashes) this.store.setRoomPersonNameClash(roomId, personId, named);
  }

  private takeChallenge(challenge: string) {
    const asked = this.challenges.get(challenge);
    this.challenges.delete(challenge);
    return asked && asked.expiresAt > this.now() ? asked : undefined;
  }

  /** Those of the invite, and every expired one. */
  private forgetChallengesFor(inviteId: string) {
    const now = this.now();
    this.challenges.forEach((each, challenge) => {
      if (each.inviteId === inviteId || each.expiresAt <= now) this.challenges.delete(challenge);
    });
  }
}
