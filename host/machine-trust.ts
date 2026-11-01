import type { Machine } from "../shared/model.ts";
import { authorityFingerprint } from "./certificates.ts";
import { HostProblemError } from "../shared/host-problems.ts";

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
