import type { Machine, MachineSeen, MachineStatus } from "./model.ts";
import { decodedInviteTunnel, encodedInviteTunnel, tunnelOrigin, type InviteTunnel } from "./tunnel.ts";

/** How long a name Settings give a machine can be, so it fits a device's lists. */
export const LONGEST_MACHINE_NAME = 40;

/** Trimmed, and cut to what every device's lists fit. */
export const fittedMachineName = (name: string) => name.trim().slice(0, LONGEST_MACHINE_NAME).trim();

/** Letters and digits nobody mistakes for one another when reading a code out or typing it. */
export const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

const inviteCodeGroup = `[${INVITE_ALPHABET}]{4}`;
const inviteCodeAlone = new RegExp(`^${inviteCodeGroup}(?:-${inviteCodeGroup}){2}$`, "i");

/** An invite code as Mirador shows it, e.g. 7K4M-2PQX-9WZB, which names no machine on its own. */
export const isInviteCodeAlone = (text: string) => inviteCodeAlone.test(text.trim());

/** The port a Mirador on its network answers at, unless its owner set another. */
export const USUAL_NETWORK_PORT = 4602;

const isOnTheLocalNetwork = (hostname: string) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[") || hostname.endsWith(".local");

/** Where a Mirador given by its local network address alone, with no port, most likely answers; null for any other address. */
export function networkAddressFor(origin: string) {
  const { port, hostname } = new URL(origin);
  return port || !isOnTheLocalNetwork(hostname) ? null : `https://${hostname}:${USUAL_NETWORK_PORT}`;
}

/**
 * An invite link's #part: the code, then the fingerprint of the machine's own certificate authority when it has one,
 * then how to reach it peer to peer when it can.
 */
const joinPath = /^#\/join\/([\w-]+?)(?:\/([\w-]+))?(?:\?tunnel=([\w-]+))?$/;

const tunnelOf = (encoded: string | undefined) => (encoded ? decodedInviteTunnel(encoded) : null);

/** The invite code in an invite link's #part, e.g. #/join/ABCD-EFGH-JKLM. */
export const joinCodeIn = (hash: string) => joinPath.exec(hash)?.[1] ?? null;

export const authorityFingerprintIn = (hash: string) => joinPath.exec(hash)?.[2] ?? null;

export const tunnelIn = (hash: string) => tunnelOf(joinPath.exec(hash)?.[3]);

export const inviteLink = (origin: string, code: string, authorityFingerprint: string | null = null, tunnel: InviteTunnel | null = null) =>
  `${origin}/#/join/${code}${authorityFingerprint ? `/${authorityFingerprint}` : ""}${tunnel ? `?tunnel=${encodedInviteTunnel(tunnel)}` : ""}`;

/**
 * A peer-to-peer invite for another computer's Mirador: mirador:// instead of an unreachable local-looking http://[fd…]
 * address, so it isn't mistaken for a browser link.
 */
export const deviceTunnelInviteLink = (code: string, tunnel: InviteTunnel) => `mirador://join/${code}?tunnel=${encodedInviteTunnel(tunnel)}`;

/**
 * A mirador:// peer-to-peer device invite link, with its invite code and tunnel.
 */
const miradorJoinLink = /^mirador:\/\/join\/([\w-]+)\?tunnel=([\w-]+)$/i;

/** A pasted link whose tunnel part was mangled still carries its code; the whole broken link must not go as the code. */
const codeInBrokenLink = (text: string) => /^mirador:\/\/join\/([\w-]+)(?:\?|$)/i.exec(text.trim())?.[1] ?? null;

/** What someone pastes to join a machine: the invite code itself, or the whole invite link. */
export function inviteIn(text: string) {
  const link = machineAddress(text);
  return { code: link?.joinCode ?? codeInBrokenLink(text) ?? text.trim(), authorityFingerprint: link?.authorityFingerprint ?? null, tunnel: link?.tunnel ?? null };
}

export interface MachineAddress {
  origin: string;
  joinCode: string | null;
  authorityFingerprint: string | null;
  tunnel: InviteTunnel | null;
}

/** What someone types or pastes for a machine: its name on the network, its address, or an invite link from it. */
export function machineAddress(text: string): MachineAddress | null {
  const trimmed = text.trim();
  if (!trimmed || isInviteCodeAlone(trimmed)) return null;
  const miradorJoin = miradorJoinLink.exec(trimmed);
  if (miradorJoin) {
    const tunnel = tunnelOf(miradorJoin[2]);
    return tunnel && { origin: tunnelOrigin(tunnel), joinCode: miradorJoin[1]!, authorityFingerprint: null, tunnel };
  }
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return { origin: url.origin, joinCode: joinCodeIn(url.hash), authorityFingerprint: authorityFingerprintIn(url.hash), tunnel: tunnelIn(url.hash) };
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
