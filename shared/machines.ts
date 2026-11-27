import type { JoinedRoom, Machine, MachineSeen, MachineStatus } from "./model.ts";
import { base64UrlOf, decodedInviteTunnel, encodedInviteTunnel, textOfBase64Url, tunnelOrigin, type InviteTunnel } from "./tunnel.ts";
import { countFrom } from "./room-reading.ts";
import { oneLine, shownAsWritten } from "./written-text.ts";

/** How long a name Settings give a machine can be, so it fits a device's lists. */
export const LONGEST_MACHINE_NAME = 40;

/** A name as this computer keeps it for a machine: one line, trimmed, and no longer than a name may be. */
export const fittedMachineName = (name: string) => oneLine(name).slice(0, LONGEST_MACHINE_NAME).trim();

/**
 * What someone else's machine's pages may do: run scripts and send forms, in an opaque origin of their own, in their
 * frame and anywhere else they open, as their relay serves them sandboxed too.
 */
export const SOMEONE_ELSES_MACHINE_SANDBOX = "allow-scripts allow-forms";

/** Letters and digits nobody mistakes for one another when reading a code out or typing it. */
export const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

const inviteCodeGroup = `[${INVITE_ALPHABET}]{4}`;
const inviteCodeAlone = new RegExp(`^${inviteCodeGroup}(?:-${inviteCodeGroup}){2}$`, "i");
const roomInviteCodeAlone = new RegExp(`^ROOM-${inviteCodeGroup}(?:-${inviteCodeGroup}){2}$`, "i");

/** An invite code as Mirador shows it, e.g. 7K4M-2PQX-9WZB, which names no machine on its own. */
export const isInviteCodeAlone = (text: string) => inviteCodeAlone.test(text.trim());

/** A room invite code as Mirador shows it, e.g. ROOM-7K4M-2PQX-9WZB, which names no machine on its own. */
export const isRoomInviteCodeAlone = (text: string) => roomInviteCodeAlone.test(text.trim());

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

/** The invite code in an invite link's #part, e.g. #/join/ABCD-EFGH-JKLM. */
export const joinCodeIn = (hash: string) => joinPath.exec(hash)?.[1] ?? null;

export const authorityFingerprintIn = (hash: string) => joinPath.exec(hash)?.[2] ?? null;

const tunnelOf = (encoded: string | undefined) => (encoded ? decodedInviteTunnel(encoded) : null);

export const tunnelIn = (hash: string) => tunnelOf(joinPath.exec(hash)?.[3]);

export const inviteLink = (origin: string, code: string, authorityFingerprint: string | null = null, tunnel: InviteTunnel | null = null) =>
  `${origin}/#/join/${code}${authorityFingerprint ? `/${authorityFingerprint}` : ""}${tunnel ? `?tunnel=${encodedInviteTunnel(tunnel)}` : ""}`;

/** A device invite link only Mirador opens, carrying the machine's tunnel alone for another computer's Mirador to paste under Machines. */
export const deviceTunnelInviteLink = (code: string, tunnel: InviteTunnel) => `mirador://join/${code}?tunnel=${encodedInviteTunnel(tunnel)}`;

/**
 * A room invite link's #part: the code, then the fingerprint of the machine's own certificate authority when it has one,
 * then either how to reach it peer to peer, or the machine's name, which a link to its address has nowhere else.
 */
const roomInvitePath = /^#\/room-invite\/([\w-]+?)(?:\/([\w-]+))?(?:\?(tunnel|name)=([\w-]+))?$/;

/**
 * The #part that a link only Mirador opens stands for, or null for any other text. Such a link, mirador://…, is for a
 * machine its tunnel alone reaches, which has no address a browser could open: what follows mirador:// in it is what
 * follows #/ in a link to an address.
 */
export function hashOfMiradorLink(text: string) {
  const path = /^mirador:\/\/(\S+)$/i.exec(text.trim())?.[1];
  return path === undefined ? null : `#/${path}`;
}

/**
 * Into a room of someone else's machine, which another Mirador joins as a person there, never as one of its owner's
 * devices. With a tunnel, the link alone is enough to join from anywhere: its origin is then the machine's address in
 * the tunnel unless the machine has an address of its own as well. Miradors before mirador:// links made theirs so.
 */
export const roomInviteLink = (origin: string, code: string, authorityFingerprint: string | null = null, tunnel: InviteTunnel | null = null) =>
  `${origin}/#/room-invite/${code}${authorityFingerprint ? `/${authorityFingerprint}` : ""}${tunnel ? `?tunnel=${encodedInviteTunnel(tunnel)}` : ""}`;

export const isRoomInviteLink = (hash: string) => roomInvitePath.test(hash);

/** How a room invite reaches the machine: peer to peer, through its tunnel, or at the address it has on the network. */
export type RoomInviteConnect = "peer-to-peer" | "address";

export const ROOM_INVITE_CONNECTS: RoomInviteConnect[] = ["peer-to-peer", "address"];

export const isRoomInviteConnect = (value: unknown): value is RoomInviteConnect => ROOM_INVITE_CONNECTS.includes(value as RoomInviteConnect);

/** The way an invite connects unless its maker picks the other: the one Settings name when it works now, else the other. */
export function inviteConnectFor(preferred: RoomInviteConnect, works: Record<RoomInviteConnect, boolean>): RoomInviteConnect | null {
  return works[preferred] ? preferred : (ROOM_INVITE_CONNECTS.find((connect) => works[connect]) ?? null);
}

/** The one way a room invite carries: the machine's tunnel and no address, or its address, with its name, and no tunnel. */
export type RoomInviteWay = { tunnel: InviteTunnel } | { origin: string; authorityFingerprint: string | null; machineName: string };

/** Far longer than a machine's name encodes to, so that a longer one is turned away before it is read. */
const LONGEST_ENCODED_NAME = 400;
const LONGEST_NAME_IN_INVITE = 200;

/** A room invite's whole text, which is all a person pastes into Join a room: a link that carries one way to the machine alone. */
export function roomInviteText(code: string, way: RoomInviteWay) {
  if ("tunnel" in way) return `mirador://room-invite/${code}?tunnel=${encodedInviteTunnel(way.tunnel)}`;
  const name = way.machineName.trim();
  return `${roomInviteLink(way.origin, code, way.authorityFingerprint)}${name ? `?name=${base64UrlOf(name)}` : ""}`;
}

/** The machine's name a room invite link to its address carries, decoded only when it is short enough; null for none or one that doesn't decode. */
function nameOf(encoded: string | undefined) {
  if (!encoded || encoded.length > LONGEST_ENCODED_NAME) return null;
  const name = textOfBase64Url(encoded);
  return name !== null && name.length <= LONGEST_NAME_IN_INVITE ? name : null;
}

/** The code in what reads as an invite link, however broken the rest of it is. */
const codeInBrokenLink = (text: string) => /(?:#\/|mirador:\/\/)(?:room-invite|join)\/([\w-]+)/i.exec(text)?.[1] ?? null;

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
  /** The name a room invite's link to the machine's address gives it, as it came, for the host to clean. */
  name: string | null;
}

const tunnelInRoomInvite = (roomInvite: RegExpExecArray) => (roomInvite[3] === "tunnel" ? tunnelOf(roomInvite[4]) : null);

/** A link only Mirador opens names the machine by its tunnel alone, so one whose tunnel isn't one is no link. */
function addressInTunnel(hash: string): MachineAddress | null {
  const roomInvite = roomInvitePath.exec(hash);
  const tunnel = roomInvite ? tunnelInRoomInvite(roomInvite) : tunnelIn(hash);
  if (!tunnel) return null;
  return { origin: tunnelOrigin(tunnel), joinCode: roomInvite?.[1] ?? joinCodeIn(hash), authorityFingerprint: null, forRoom: roomInvite !== null, tunnel, name: null };
}

/** What someone types or pastes for a machine: its name on the network, its address, or an invite link from it; an invite link whose tunnel isn't one is none. */
export function machineAddress(text: string): MachineAddress | null {
  const trimmed = text.trim();
  if (!trimmed || isInviteCodeAlone(trimmed) || isRoomInviteCodeAlone(trimmed)) return null;
  const miradorLinkHash = hashOfMiradorLink(trimmed);
  if (miradorLinkHash) return addressInTunnel(miradorLinkHash);
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const roomInvite = roomInvitePath.exec(url.hash);
    const tunnel = roomInvite && tunnelInRoomInvite(roomInvite);
    if (roomInvite?.[3] === "tunnel" && !tunnel) return null;
    const name = roomInvite?.[3] === "name" ? nameOf(roomInvite[4]) : null;
    if (roomInvite) return { origin: url.origin, joinCode: roomInvite[1]!, authorityFingerprint: roomInvite[2] ?? null, forRoom: true, tunnel, name };
    const join = joinPath.exec(url.hash);
    const joinTunnel = join?.[3] ? tunnelOf(join[3]) : null;
    if (join?.[3] && !joinTunnel) return null;
    return { origin: url.origin, joinCode: join?.[1] ?? null, authorityFingerprint: join?.[2] ?? null, forRoom: false, tunnel: joinTunnel, name: null };
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

/** How many rooms of one machine its list shows at most, and how long a name of one may be there. */
export const MOST_JOINED_ROOMS = 50;

/** The most entries of a list of rooms someone else's machine sends that this host reads, its rooms past them left out. */
export const MOST_ROOMS_READ = MOST_JOINED_ROOMS * 2;
export const LONGEST_JOINED_ROOM_NAME = 80;

/** The form a room's id has, which nothing else in a list or a link to a room may take. */
export const isRoomId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{1,64}$/.test(id);

/**
 * A room as someone else's machine lists it, made safe to show: an id of a room's form, its name on one line, as
 * everyone reads it, cut to length, and its counts made counts; null when the id or the name is not there.
 */
export function joinedRoomIn(listed: unknown): JoinedRoom | null {
  if (typeof listed !== "object" || listed === null) return null;
  const { id, name, unread, mentions, toConfirm, toApprove, muted } = listed as Record<string, unknown>;
  if (!isRoomId(id) || typeof name !== "string") return null;
  const shownName = oneLine(shownAsWritten(name.slice(0, LONGEST_JOINED_ROOM_NAME * 4))).slice(0, LONGEST_JOINED_ROOM_NAME).trim();
  return shownName ? { id, name: shownName, unread: countFrom(unread), mentions: countFrom(mentions), toConfirm: countFrom(toConfirm), toApprove: countFrom(toApprove), muted: muted === true } : null;
}

/** The rooms someone else's machine lists for this computer's owner, each once, at most MOST_JOINED_ROOMS of them, as display data only. */
export function joinedRoomsIn(listed: unknown): JoinedRoom[] {
  if (!Array.isArray(listed)) return [];
  const rooms = listed.slice(0, MOST_ROOMS_READ).flatMap((each) => joinedRoomIn(each) ?? []);
  return rooms.filter((room, index) => rooms.findIndex(({ id }) => id === room.id) === index).slice(0, MOST_JOINED_ROOMS);
}

/** The list with the room the machine says changed, in its place, keeping its counts, or last; a room past MOST_JOINED_ROOMS stays out. */
export function withJoinedRoom(rooms: JoinedRoom[], listed: unknown): JoinedRoom[] {
  const room = joinedRoomIn(listed);
  if (!room) return rooms;
  if (rooms.some(({ id }) => id === room.id)) return rooms.map((each) => (each.id === room.id ? { ...each, name: room.name } : each));
  return rooms.length < MOST_JOINED_ROOMS ? [...rooms, room] : rooms;
}

/** The listed rooms with the counts the machine says each has now; a room it says nothing of has none. */
export function withReadings(rooms: JoinedRoom[], readings: unknown): JoinedRoom[] {
  const said = Array.isArray(readings) ? readings.slice(0, MOST_JOINED_ROOMS * 2).filter((reading): reading is Record<string, unknown> => typeof reading === "object" && reading !== null) : [];
  return rooms.map((room) => {
    const reading = said.find(({ roomId }) => roomId === room.id) ?? {};
    return { ...room, unread: countFrom(reading.unread), mentions: countFrom(reading.mentions), toConfirm: countFrom(reading.toConfirm), toApprove: countFrom(reading.toApprove), muted: reading.muted === true };
  });
}

export const withoutJoinedRoom = (rooms: JoinedRoom[], roomId: unknown) => rooms.filter(({ id }) => id !== roomId);
