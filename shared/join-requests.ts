import { HostProblemError } from "./host-problems.ts";
/** Long enough that something posing as the machine matches the number by chance once in a million tries. */
const NUMBER_DIGITS = 6;
const POLL_INTERVAL_MS = 2_000;

const sha256 = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const newNonce = () => base64url(crypto.getRandomValues(new Uint8Array(32)));

/** Sent before the nonce itself, so the device asking is bound to its nonce before it learns the machine's. */
export const commitmentTo = async (nonce: string) => base64url(await sha256(nonce));

/**
 * The number the device asking to join shows, and the approver types on the machine. Each side works it out from the
 * certificate authority it checked the other's certificate against, so a machine in between gets a different number;
 * as each side's nonce is fixed before the other's is known, it cannot try nonces until the numbers agree.
 */
export async function matchingNumber(authorityFingerprint: string | null, requesterNonce: string, machineNonce: string) {
  const digest = await sha256(["mirador-join", authorityFingerprint ?? "", requesterNonce, machineNonce].join("\n"));
  const number = new DataView(digest.buffer).getUint32(0) % 10 ** NUMBER_DIGITS;
  return String(number).padStart(NUMBER_DIGITS, "0");
}

/** E.g. 123 456, easier to read out and compare than 123456. */
export const spacedNumber = (number: string) => `${number.slice(0, 3)} ${number.slice(3)}`;

export const typedNumber = (text: string) => text.replace(/\D/g, "");

export interface JoinRequestOpened {
  id: string;
  secret: string;
  machineNonce: string;
  /** Milliseconds until the request expires, as the clocks of the two machines may disagree. */
  expiresIn: number;
}

export type JoinRequestAnswer = { answer: "waiting" } | { answer: "denied" } | { answer: "approved"; deviceId: string; token: string };

export interface Asking {
  /** What the device is called among the machine's devices. */
  name: string;
  /** Of the certificate authority the device checked the machine's certificate against; null when it trusted it otherwise. */
  authorityFingerprint: string | null;
  machineName: string;
}

/**
 * Asks a machine to let this device in, and waits until someone there approves it by typing the number shown, which
 * shown hands over; resolves to the device's token. send posts JSON to a path of the machine, or null if it did not answer.
 */
export async function askToJoin(send: (path: string, body: object) => Promise<Response | null>, asking: Asking, shown: (number: string) => void) {
  const { machineName } = asking;
  const answered = async (response: Response | null) => {
    if (!response) throw new HostProblemError({ code: "machine-did-not-answer", machine: machineName });
    if (!response.ok) throw new Error(await response.text());
    return response;
  };
  const nonce = newNonce();
  const asked = await send("/join-requests", { name: asking.name, commitment: await commitmentTo(nonce), authorityFingerprint: asking.authorityFingerprint });
  const opened = (await (await answered(asked)).json()) as JoinRequestOpened;
  const sendAbout = (step: string, body: object = {}) => send(`/join-requests/${opened.id}/${step}`, { secret: opened.secret, ...body });
  await answered(await sendAbout("reveal", { nonce }));
  shown(await matchingNumber(asking.authorityFingerprint, nonce, opened.machineNonce));

  const giveUpAt = Date.now() + opened.expiresIn;
  while (Date.now() < giveUpAt) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const response = await sendAbout("poll");
    if (!response) continue;
    const answer = (await (await answered(response)).json()) as JoinRequestAnswer;
    if (answer.answer === "denied") throw new HostProblemError({ code: "join-request-denied", machine: machineName });
    if (answer.answer === "approved") return answer.token;
  }
  throw new HostProblemError({ code: "join-request-timed-out", machine: machineName });
}
