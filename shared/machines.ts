import type { Machine, MachineSeen, MachineStatus } from "./model.ts";
import { decodedInviteTunnel, encodedInviteTunnel, type InviteTunnel } from "./tunnel.ts";

/** How long a name Settings give a machine can be, so it fits a device's lists. */
export const LONGEST_MACHINE_NAME = 40;

/**
 * What someone else's machine's pages may do: run scripts and send forms, in an opaque origin of their own, in their
 * frame and anywhere else they open, as their relay serves them sandboxed too.
 */
export const SOMEONE_ELSES_MACHINE_SANDBOX = "allow-scripts allow-forms";

/**
 * An invite link's #part: the code, then the fingerprint of the machine's own certificate authority when it has one,
 * then how to reach it peer to peer when it can.
 */
const joinPath = /^#\/join\/([\w-]+?)(?:\/([\w-]+))?(?:\?tunnel=([\w-]+))?$/;

/** The invite code in an invite link's #part, e.g. #/join/ABCD-EFGH-JKLM. */
export const joinCodeIn = (hash: string) => joinPath.exec(hash)?.[1] ?? null;

export const authorityFingerprintIn = (hash: string) => joinPath.exec(hash)?.[2] ?? null;

const tunnelOf = (encoded: string | undefined) => (encoded ? decodedInviteTunnel(encoded) : null);

export const tunnelIn = (hash: string) => tunnelOf(joinPath.exec(hash)?.[3]);

export const inviteLink = (origin: string, code: string, authorityFingerprint: string | null = null, tunnel: InviteTunnel | null = null) =>
  `${origin}/#/join/${code}${authorityFingerprint ? `/${authorityFingerprint}` : ""}${tunnel ? `?tunnel=${encodedInviteTunnel(tunnel)}` : ""}`;

/** A room invite link's #part: the code, then the fingerprint of the machine's own certificate authority when it has one, then how to reach it peer to peer when it can. */
const roomInvitePath = /^#\/room-invite\/([\w-]+?)(?:\/([\w-]+))?(?:\?tunnel=([\w-]+))?$/;

/**
 * Into a room of someone else's machine, which another Mirador joins as a person there, never as one of its owner's
 * devices. With a tunnel, the link alone is enough to join from anywhere: its origin is then the machine's address in
 * the tunnel unless the machine has an address of its own as well.
 */
export const roomInviteLink = (origin: string, code: string, authorityFingerprint: string | null = null, tunnel: InviteTunnel | null = null) =>
  `${origin}/#/room-invite/${code}${authorityFingerprint ? `/${authorityFingerprint}` : ""}${tunnel ? `?tunnel=${encodedInviteTunnel(tunnel)}` : ""}`;

export const isRoomInviteLink = (hash: string) => roomInvitePath.test(hash);

/** The code in what reads as an invite link, however broken the rest of it is. */
const codeInBrokenLink = (text: string) => /#\/(?:room-invite|join)\/([\w-]+)/.exec(text)?.[1] ?? null;

/**
 * What someone pastes to join a machine: the invite code itself, or the whole invite link, which may carry the way
 * through the machine's tunnel. Of a link, only the code ever goes to the machine as one.
 */
export function inviteIn(text: string) {
  const link = machineAddress(text);
  return { code: link?.joinCode ?? codeInBrokenLink(text) ?? text.trim(), authorityFingerprint: link?.authorityFingerprint ?? null, tunnel: link?.tunnel ?? null };
}

export interface MachineAddress {
  origin: string;
  joinCode: string | null;
  authorityFingerprint: string | null;
  /** A room invite's link, which this computer's owner joins as a person. */
  forRoom: boolean;
  /** How a room invite's link reaches the machine peer to peer, when it can. */
  tunnel: InviteTunnel | null;
}

/** What someone types or pastes for a machine: its name on the network, its address, or an invite link from it; a room invite's link whose tunnel isn't one is none. */
export function machineAddress(text: string): MachineAddress | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const roomInvite = roomInvitePath.exec(url.hash);
    const tunnel = tunnelOf(roomInvite?.[3]);
    if (roomInvite?.[3] && !tunnel) return null;
    if (roomInvite) return { origin: url.origin, joinCode: roomInvite[1]!, authorityFingerprint: roomInvite[2] ?? null, forRoom: true, tunnel };
    return { origin: url.origin, joinCode: joinCodeIn(url.hash), authorityFingerprint: authorityFingerprintIn(url.hash), forRoom: false, tunnel: null };
  } catch {
    return null;
  }
}

/** A machine one of this computer's machines has joined, which this computer can join too. */
export interface MachineToJoin extends MachineSeen {
  /** The first of this computer's machines, in their order, that has joined it. */
  throughMachineId: string;
}

/** The same Mirador: at the same address, or with the same id at another. */
export const sameMachine = (one: Pick<MachineSeen, "origin" | "hostId">, other: Pick<MachineSeen, "origin" | "hostId">) =>
  one.origin === other.origin || (one.hostId !== null && one.hostId === other.hostId);

/** The machines this computer's machines have joined, once each, leaving out those it has added itself. */
export function machinesSeen(machines: Machine[], statuses: MachineStatus[]): MachineToJoin[] {
  const seen = machines.flatMap(({ id }) =>
    (statuses.find(({ machineId }) => machineId === id)?.joinedThere ?? []).map((machine) => ({ ...machine, throughMachineId: id })),
  );
  const isFirstListing = (machine: MachineToJoin, index: number) => seen.findIndex((other) => sameMachine(machine, other)) === index;
  return seen.filter((machine, index) => !machines.some((added) => sameMachine(machine, added)) && isFirstListing(machine, index));
}

export const isHidden = (machine: MachineSeen, hidden: MachineSeen[]) => hidden.some((one) => sameMachine(machine, one));
