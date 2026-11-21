import { HostProblemError } from "../shared/host-problems.ts";
import { isPastel, type Device, type Pastel } from "../shared/model.ts";
import { NAMES_KEPT_BY_MIRADOR, nameRefused, nameTaken, personName } from "../shared/people.ts";
import { isRoomRole, type RoomInvite, type RoomRole } from "../shared/rooms.ts";
import { shownAsWritten } from "../shared/written-text.ts";
import { inviteKey, newRoomInvite, type DeviceService } from "./devices.ts";
import { isChallenge, newChallenge, NO_AUTHORITY, signedRoomJoin } from "./person-keys.ts";
import { namesOthersGoBy } from "./person-view.ts";
import type { Store } from "./store.ts";

const CHALLENGE_LIFETIME_MILLISECONDS = 2 * 60_000;
/** Far longer than a name the rules keep, so a longer one is turned away before they read it all. */
const LONGEST_PRESENTED_NAME = 400;

interface Challenge {
  inviteId: string;
  /** The host and port the joiner asked for it at, which its signature must name. */
  host: string;
  expiresAt: number;
}

/** How the joiner reached this machine: the host and port it asked at, and the fingerprint of this machine's own certificate authority if it served that request a certificate of its own, else NO_AUTHORITY. */
export interface ReachedAt {
  host: string;
  authorityFingerprint: string;
}

/** This machine serves its own certificate only over HTTPS of its own; a proxy in front of it, such as tailscale serve, reaches it over HTTP. */
export const reachedAt = (request: Request, ownAuthorityFingerprint: string | null): ReachedAt => ({
  host: request.headers.get("host") ?? "",
  authorityFingerprint: (new URL(request.url).protocol === "https:" && ownAuthorityFingerprint) || NO_AUTHORITY,
});

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
 * proves the key they present by signing the challenge, the invite, this machine's address as they reached it and the
 * certificate authority they trusted it by, so a signature made for another invite or machine, passed on by someone in
 * between, or used once already, admits nobody. A proof that fails and one with the owner's key are turned away alike.
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

  withdraw(inviteId: string) {
    this.store.deleteRoomInvite(inviteId);
    this.forgetChallengesFor(inviteId);
  }

  waitsFor(code: string) {
    return this.store.findRoomInvite(inviteKey(code), this.now()) !== undefined;
  }

  /** A challenge for whoever holds a waiting room invite's code to sign; the newest for an invite replaces the one before. Null for any other code. */
  challenge(code: string, host: string): string | null {
    const invite = this.store.findRoomInvite(inviteKey(code), this.now());
    if (!invite) return null;
    this.forgetChallengesFor(invite.id);
    const challenge = newChallenge();
    this.challenges.set(challenge, { inviteId: invite.id, host, expiresAt: this.now() + CHALLENGE_LIFETIME_MILLISECONDS });
    return challenge;
  }

  /**
   * Uses the invite up for the person whose key signed the challenge made for it at `host`: the same key is the same
   * person, who gains the room, and a new key a new person. Their device, their place in the room with the invite's role
   * and the name they presented are made in one go. The challenge is used up whatever comes of it.
   */
  redeem(code: string, deviceName: string, presented: unknown, { host, authorityFingerprint }: ReachedAt): Admitted {
    const { publicKey, name, color, challenge, signature } = (typeof presented === "object" && presented !== null ? presented : {}) as Record<string, unknown>;
    const asked = isChallenge(challenge) ? this.takeChallenge(challenge) : undefined;
    const codeKey = inviteKey(code);
    const invite = this.store.findRoomInvite(codeKey, this.now());
    if (!invite) throw new HostProblemError({ code: "invite-code-wrong" });
    const proven =
      isChallenge(challenge) &&
      asked?.inviteId === invite.id &&
      asked.host === host &&
      typeof publicKey === "string" &&
      signedRoomJoin({ challenge, inviteKey: codeKey, host, authorityFingerprint, publicKey }, signature);
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
