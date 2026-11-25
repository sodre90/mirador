import { HostProblemError } from "../shared/host-problems.ts";
import { isPastel, type Device, type Pastel } from "../shared/model.ts";
import { nameRefused, nameTaken, personName, readsAsMiradorsWords } from "../shared/people.ts";
import { broughtAgentName, isRoomInviteLetsIn, isRoomInviteLifetime, isRoomInviteSeats, isRoomRole, type RoomInvite, type RoomInviteLetsIn, type RoomInviteLifetime, type RoomInviteSeats, type RoomJoiner, type RoomRole } from "../shared/rooms.ts";
import { shownAsWritten } from "../shared/written-text.ts";
import type { InviteTunnel } from "../shared/tunnel.ts";
import { inviteKey, newRoomInvite, type DeviceService } from "./devices.ts";
import { isChallenge, newChallenge, NO_AUTHORITY, signedRoomJoin, type ReachedAt } from "./person-keys.ts";
import { namesOthersGoBy, namesShownIn } from "./person-view.ts";
import type { PeerToPeer, TunnelEnd } from "./p2p/service.ts";
import type { Store, StoredRoomJoiner } from "./store.ts";

const CHALLENGE_LIFETIME_MILLISECONDS = 2 * 60_000;
const HOUR_MILLISECONDS = 60 * 60_000;
const DAY_MILLISECONDS = 24 * HOUR_MILLISECONDS;
const INVITE_LIFETIME_MILLISECONDS: Record<RoomInviteLifetime, number> = { "15-minutes": 15 * 60_000, "1-hour": HOUR_MILLISECONDS, "1-day": DAY_MILLISECONDS, "7-days": 7 * DAY_MILLISECONDS };
/** Far longer than a name the rules keep, so a longer one is turned away before they read it all. */
const LONGEST_PRESENTED_NAME = 400;

export type { ReachedAt } from "./person-keys.ts";

interface Challenge {
  inviteId: string;
  /** How the joiner asked for it, which its signature must name and its join must come the same way. */
  reachedAt: ReachedAt;
  /** Who asked for it, as the limits on joining tell senders apart. */
  requester: string;
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

/**
 * What came of a room invite: a device of a person other than the owner, and the room it let them into, or, `waiting`,
 * whose door they wait at for the owner to let them in, with nothing of the room theirs until then.
 */
export interface Admitted {
  device: Device;
  token: string;
  personId: string;
  roomId: string;
  waiting: boolean;
  previousRole: RoomRole | null;
}

/** Of a name a person presented, what the name rules let them go by: cleaned, or none. */
function presentedName(presented: unknown) {
  return typeof presented === "string" && presented.length <= LONGEST_PRESENTED_NAME && !nameRefused(presented) ? personName(shownAsWritten(presented)) : "";
}

/**
 * Of a name a person presented, the one they may go by beside names `taken` already: none where the name rules refuse it
 * or it reads as Mirador's own words, and none, with the name it clashes as, where it reads as one taken.
 */
function checkedName(presented: unknown, taken: string[]): { name: string; nameClash?: string } {
  const named = presentedName(presented);
  if (readsAsMiradorsWords(named)) return { name: "" };
  return nameTaken(named, taken) ? { name: "", nameClash: named } : { name: named };
}

/**
 * Invites into a room, each for as many people as its seats with one role, kept apart from device invites: only the code
 * of a room invite with seats left gets a challenge or admits anyone here, and what it admits is always a person other
 * than the owner. The person proves the key they present by signing the challenge, the invite, and how they reached this
 * machine: its address and the certificate authority they trusted it by, or its key in the peer-to-peer tunnel. So a
 * signature made for another invite or machine, passed on by someone in between, asked for one way and used another, or
 * used once already, admits nobody. A proof that fails and one with the owner's key are turned away alike.
 *
 * Each person an invite admits takes one of its seats for good, whether they come in at once, wait for the owner's OK,
 * or are turned away; the same key never takes a second. Once its seats are taken the invite goes, as when it expires or
 * the owner withdraws it. Those who wait outlive their invite, until the owner lets them in or turns them away.
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

  invite(roomId: string, role: RoomRole, seats: RoomInviteSeats, letsIn: RoomInviteLetsIn, lifetime: RoomInviteLifetime): { invite: RoomInvite; code: string } {
    if (!this.store.findRoom(roomId)) throw new HostProblemError({ code: "room-gone" });
    if (!isRoomRole(role)) throw new Error(`There is no room role "${role}".`);
    if (!isRoomInviteSeats(seats)) throw new Error(`A room invite can't be for ${seats} people.`);
    if (!isRoomInviteLetsIn(letsIn)) throw new Error(`A room invite can't let people in "${letsIn}".`);
    if (!isRoomInviteLifetime(lifetime)) throw new Error(`A room invite can't work for "${lifetime}".`);
    const { code, expiresAt } = newRoomInvite(this.now(), INVITE_LIFETIME_MILLISECONDS[lifetime]);
    const invite = { id: crypto.randomUUID(), roomId, role, expiresAt, seats, letsIn, taken: 0 };
    this.store.addRoomInvite(invite, inviteKey(code));
    return { invite, code };
  }

  waiting(): RoomInvite[] {
    return this.store.waitingRoomInvites(this.now());
  }

  joiners(): RoomJoiner[] {
    return this.store.roomJoiners().map((joiner) => this.atTheDoor(joiner));
  }

  joiner(roomId: string, personId: string): RoomJoiner | undefined {
    const joiner = this.store.findRoomJoiner(roomId, personId);
    return joiner && this.atTheDoor(joiner);
  }

  /** Of an invite into a room, by its code as `inviteKey` keeps it, the seats it has left; one for any other code. */
  seatsLeftFor(codeKey: string) {
    const invite = this.store.findRoomInvite(codeKey, this.now());
    return invite ? invite.seats - invite.taken : 1;
  }

  /** The rooms the person waits to be let into, which is all they learn of them until then. */
  roomsWaitedForBy(personId: string): string[] {
    return this.store.roomsWaitedForBy(personId);
  }

  /** In with the role their invite gave and the name they presented, as an invite that lets people in at once would have. */
  letIn(roomId: string, personId: string) {
    const joiner = this.store.findRoomJoiner(roomId, personId);
    if (!joiner) throw new HostProblemError({ code: "room-joiner-gone" });
    this.store.inOneTransaction(() => {
      this.store.setRoomPersonRole(roomId, personId, joiner.role);
      this.namePerson(roomId, personId, joiner.presentedName, joiner.color);
    });
  }

  /** They keep the seat they took, so the same invite lets them knock no more. */
  turnAway(roomId: string, personId: string) {
    if (!this.store.deleteRoomJoiner(roomId, personId)) throw new HostProblemError({ code: "room-joiner-gone" });
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

  /**
   * A challenge for whoever holds the code of a room invite with seats left to sign; null for any other code. Each
   * requester keeps one challenge for each seat left, so as many people as it has seats can join at once, even from one
   * address, and its newest replaces its oldest, never another requester's. Through the tunnel everyone with the link is
   * one requester, as nothing there tells them apart.
   */
  challenge(code: string, reached: ReachedAt, requester: string): string | null {
    const invite = this.store.findRoomInvite(inviteKey(code), this.now());
    if (!invite) return null;
    this.forgetChallengesBeyondSeats(invite, requester);
    const challenge = newChallenge();
    this.challenges.set(challenge, { inviteId: invite.id, reachedAt: reached, requester, expiresAt: this.now() + CHALLENGE_LIFETIME_MILLISECONDS });
    return challenge;
  }

  /**
   * Takes a seat of the invite for the person whose key signed the challenge made for it, reached as `reached`: the same key
   * is the same person, and a new key a new person. Their device, their seat, and their place in the room with the invite's
   * role and the name they presented, or at its door, are made in one go. A key that took a seat of the invite before takes
   * none again. The challenge is used up whatever comes of it; with the invite's last seat taken, its one-time key in the
   * tunnel is over.
   */
  redeem(code: string, deviceName: string, presented: unknown, reached: ReachedAt, p2p: Pick<PeerToPeer, "inviteUsed"> | null = null): Admitted {
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
    const { admitted, wasLastSeat } = this.store.inOneTransaction(() => {
      const personId = this.personWithKey(publicKey);
      if (this.store.tookRoomInviteSeat(invite.id, personId)) throw new HostProblemError({ code: "room-invite-used-already" });
      const wasLastSeat = this.store.takeRoomInviteSeat(invite.id, personId);
      const { waiting, previousRole } = this.comeIn(invite, personId, { name, color: isPastel(color) ? color : null, deviceName });
      return { admitted: { ...this.devices.admit(deviceName, personId), personId, roomId: invite.roomId, waiting, previousRole }, wasLastSeat };
    });
    if (wasLastSeat) this.lastSeatTaken(invite.id, code, p2p);
    return admitted;
  }

  /**
   * Into the room with the invite's role and the name they presented, or, where it asks the owner's OK first, at the
   * room's door, with nothing of theirs changed until the owner lets them in; someone already in the room stays in it as
   * they are then. Whether they wait, and any role they held in the room before.
   */
  private comeIn(invite: RoomInvite, personId: string, { name, color, deviceName }: { name: unknown; color: Pastel | null; deviceName: string }) {
    const existing = this.store.findRoom(invite.roomId)?.people.find((person) => person.personId === personId);
    if (invite.letsIn === "at-once") {
      this.store.setRoomPersonRole(invite.roomId, personId, invite.role);
      this.namePerson(invite.roomId, personId, name, color);
      return { waiting: false, previousRole: existing?.role ?? null };
    }
    const inTheRoom = existing !== undefined;
    if (!inTheRoom) this.store.addRoomJoiner({ roomId: invite.roomId, personId, role: invite.role, presentedName: presentedName(name), color, deviceName, since: this.now() });
    return { waiting: !inTheRoom, previousRole: existing?.role ?? null };
  }

  /**
   * Someone at the room's door as its owner sees them: by the name they presented, as the room would let them take it
   * now, beside its owner, its people, who wrote there and its agents. They learn nothing of it.
   */
  private atTheDoor({ presentedName: presented, color: _takenOnceLetIn, ...joiner }: StoredRoomJoiner): RoomJoiner {
    const room = this.store.findRoom(joiner.roomId);
    return { ...joiner, ...checkedName(presented, room ? namesShownIn(this.store, room, joiner.personId) : []) };
  }

  private lastSeatTaken(inviteId: string, code: string, p2p: Pick<PeerToPeer, "inviteUsed"> | null) {
    this.forgetChallengesFor(inviteId);
    p2p?.inviteUsed(code);
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
    const checked = checkedName(presented, namesOthersGoBy(this.store, personId));
    const { name, nameClash } = checked.name && this.broughtAgentsClash(personId, checked.name) ? { name: "", nameClash: checked.name } : checked;
    this.store.setPersonProfile(personId, { name, color });
    this.store.forgetNameClashesOf(personId);
    if (nameClash) this.store.setRoomPersonNameClash(roomId, personId, nameClash);
  }

  private broughtAgentsClash(personId: string, name: string) {
    const people = this.store.listPeople();
    return this.store.roomsOf(personId).some((room) => {
      const personIds = new Set([this.store.ownerId(), ...room.people.map(({ personId: id }) => id), ...this.store.writersIn(room.id)]);
      personIds.delete(personId);
      const taken = [
        ...people.filter(({ id }) => personIds.has(id)).map(({ name: each }) => each),
        ...room.agents.flatMap((agent) => {
          if (agent.brought?.personId === personId) return [];
          if (agent.brought) {
            const bringer = people.find(({ id }) => id === agent.brought!.personId)?.name ?? "";
            return [broughtAgentName(bringer, agent.brought.name)];
          }
          const profile = this.store.findProfile(agent.profileId);
          return profile ? [profile.name] : [];
        }),
      ];
      return room.agents.filter((agent) => agent.brought?.personId === personId).some(({ brought }) => nameTaken(broughtAgentName(name, brought!.name), taken));
    });
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

  /** Every expired one, and of the requester's for the invite the oldest, until one more leaves them no more than a challenge for each seat left. */
  private forgetChallengesBeyondSeats({ id, seats, taken }: RoomInvite, requester: string) {
    const now = this.now();
    this.challenges.forEach((each, challenge) => each.expiresAt <= now && this.challenges.delete(challenge));
    const theirs = [...this.challenges].filter(([, each]) => each.inviteId === id && each.requester === requester).map(([challenge]) => challenge);
    const keptBesideNew = Math.max(0, seats - taken - 1);
    theirs.slice(0, Math.max(0, theirs.length - keptBesideNew)).forEach((challenge) => this.challenges.delete(challenge));
  }
}
