import { decodedInviteTunnel, encodedInviteTunnel, type InviteTunnel } from "./tunnel.ts";

/** How long a name Settings give a machine can be, so it fits a device's lists. */
export const LONGEST_MACHINE_NAME = 40;

/**
 * An invite link's #part: the code, then the fingerprint of the machine's own certificate authority when it has one,
 * then how to reach it peer to peer when it can.
 */
const joinPath = /^#\/join\/([\w-]+?)(?:\/([\w-]+))?(?:\?tunnel=([\w-]+))?$/;

/** The invite code in an invite link's #part, e.g. #/join/ABCD-EFGH-JKLM. */
export const joinCodeIn = (hash: string) => joinPath.exec(hash)?.[1] ?? null;

export const authorityFingerprintIn = (hash: string) => joinPath.exec(hash)?.[2] ?? null;

export function tunnelIn(hash: string) {
  const encoded = joinPath.exec(hash)?.[3];
  return encoded ? decodedInviteTunnel(encoded) : null;
}

export const inviteLink = (origin: string, code: string, authorityFingerprint: string | null = null, tunnel: InviteTunnel | null = null) =>
  `${origin}/#/join/${code}${authorityFingerprint ? `/${authorityFingerprint}` : ""}${tunnel ? `?tunnel=${encodedInviteTunnel(tunnel)}` : ""}`;

/** What someone pastes to join a machine: the invite code itself, or the whole invite link. */
export function inviteIn(text: string) {
  const link = machineAddress(text);
  return { code: link?.joinCode ?? text.trim(), authorityFingerprint: link?.authorityFingerprint ?? null };
}

/** What someone types or pastes for a machine: its name on the network, its address, or an invite link from it. */
export function machineAddress(text: string): { origin: string; joinCode: string | null; authorityFingerprint: string | null } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return { origin: url.origin, joinCode: joinCodeIn(url.hash), authorityFingerprint: authorityFingerprintIn(url.hash) };
  } catch {
    return null;
  }
}
