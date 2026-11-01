import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** One line per Mac allowed to send: the SHA-256 of its token, then a label the owner chose for it. */
interface HostToken {
  hash: Buffer;
  label: string;
}

const LABEL = /^[\w.-]{1,64}$/;

const hashOf = (token: string) => createHash("sha256").update(token).digest();

function read(file: string): HostToken[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([hash, label]) => hash && label)
    .map(([hash, label]) => ({ hash: Buffer.from(hash, "hex"), label }));
}

function write(file: string, tokens: HostToken[]) {
  writeFileSync(file, tokens.map(({ hash, label }) => `${hash.toString("hex")} ${label}\n`).join(""), { mode: 0o600 });
}

/** Makes a token for the Mac named `label` and keeps only its hash; the token itself is shown once, to the owner. */
export function addHostToken(file: string, label: string) {
  if (!LABEL.test(label)) throw new Error("A label is up to 64 letters, digits, dots, dashes and underscores.");
  const tokens = read(file);
  if (tokens.some((token) => token.label === label)) throw new Error(`There is a token labelled ${label} already.`);
  const token = randomBytes(32).toString("base64url");
  write(file, [...tokens, { hash: hashOf(token), label }]);
  return token;
}

export function removeHostToken(file: string, label: string) {
  const tokens = read(file);
  if (!tokens.some((token) => token.label === label)) throw new Error(`No token is labelled ${label}.`);
  write(file, tokens.filter((token) => token.label !== label));
}

export const hostTokenLabels = (file: string) => read(file).map(({ label }) => label);

/** The label of the Mac that `token` belongs to, read afresh so a removed line takes effect at once; null for any other token. */
export function hostOf(file: string, token: string): string | null {
  const presented = hashOf(token);
  return read(file).reduce<string | null>((found, { hash, label }) => (hash.length === presented.length && timingSafeEqual(hash, presented) ? label : found), null);
}
