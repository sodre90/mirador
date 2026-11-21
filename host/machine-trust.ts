import { isIPv4, isIPv6 } from "node:net";
import type { MachineAddress } from "../shared/machines.ts";
import type { Machine } from "../shared/model.ts";
import { tunnelOrigin, type InviteTunnel } from "../shared/tunnel.ts";
import { authorityFingerprint } from "./certificates.ts";
import { HostProblemError, type HostProblem } from "../shared/host-problems.ts";

/** Checks a machine's certificate against the certificate authority this host trusts it by, or the computer's own ones when there is none. */
export const trusting = (authority: string | null) => (authority ? { tls: { ca: authority } } : {});

const answersTrusted = (origin: string) => fetch(origin, { method: "HEAD" }).then(() => true, () => false);

function fingerprintOf(certificate: string) {
  try {
    return authorityFingerprint(certificate);
  } catch {
    return null;
  }
}

/**
 * The certificate authority a machine's Mirador made its certificate with, when the computer's own ones don't vouch
 * for that certificate; null when they do, or when the machine is reached without TLS. Read without checking the
 * certificate, so it is only to be trusted once its fingerprint matches one learnt some other way.
 */
export async function offeredAuthority(machine: Machine): Promise<{ authority: string; fingerprint: string } | null> {
  if (new URL(machine.origin).protocol !== "https:" || (await answersTrusted(machine.origin))) return null;
  const response = await fetch(`${machine.origin}/mirador-ca.pem`, { tls: { rejectUnauthorized: false } }).catch(() => null);
  if (!response) throw new HostProblemError({ code: "machine-did-not-answer", machine: machine.name });
  const authority = response.ok ? await response.text() : "";
  const fingerprint = fingerprintOf(authority);
  if (!fingerprint) throw new HostProblemError({ code: "machine-certificate-untrusted", machine: machine.name });
  return { authority, fingerprint };
}

/** Within this computer or a private network: loopback, the private ranges and Tailscale's 100.64.0.0/10 in IPv4, loopback, unique local and link-local addresses in IPv6. */
export function isPrivateHostname(hostname: string) {
  const address = hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (address === "localhost") return true;
  if (isIPv6(address)) return address === "::1" || /^f[cd]/.test(address) || /^fe[89ab]/.test(address);
  if (!isIPv4(address)) return false;
  const [first = 0, second = 0] = address.split(".").map(Number);
  const inRange = (start: number, end: number) => second >= start && second <= end;
  return first === 127 || first === 10 || (first === 172 && inRange(16, 31)) || (first === 192 && second === 168) || (first === 100 && inRange(64, 127)) || (first === 169 && second === 254);
}

/** How what was pasted reaches the machine: its origin, the tunnel this computer dials there if any, and whether a certificate authority of the machine's own is trusted the first time it is seen. */
export interface WayToMachine {
  origin: string;
  tunnel: InviteTunnel | null;
  trustsOnFirstUse: boolean;
}

/**
 * A link that carries the machine's tunnel joins through it unless something keeps this computer from dialing tunnels,
 * `whyNotDialing`, which a link with no other address says. Elsewhere its code goes to the link's address only where
 * nothing on the way reads it: over HTTPS whose certificate the computer's own authorities or the link's fingerprint
 * vouch for, never one trusted on first use, or over plain HTTP within a private network. An address or a link without
 * a tunnel is reached as it is.
 */
export function wayToMachine({ origin, tunnel }: Pick<MachineAddress, "origin" | "tunnel">, whyNotDialing: HostProblem | null): WayToMachine {
  if (!tunnel) return { origin, tunnel: null, trustsOnFirstUse: true };
  if (!whyNotDialing) return { origin: tunnelOrigin(tunnel), tunnel, trustsOnFirstUse: false };
  if (origin === tunnelOrigin(tunnel)) throw new HostProblemError(whyNotDialing);
  const { protocol, hostname } = new URL(origin);
  if (protocol === "http:" && !isPrivateHostname(hostname)) throw new HostProblemError({ code: "invite-address-unprotected", address: origin });
  return { origin, tunnel: null, trustsOnFirstUse: false };
}
