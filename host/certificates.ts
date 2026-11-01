import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { join, win32 } from "node:path";
import { gitInstallFolders, onPathOf } from "./command-shell.ts";
import { localNetworkName } from "./config.ts";

const AUTHORITY_DAYS = 3650;
/** Apple's platforms refuse longer-lived TLS server certificates, whoever issued them. */
const SERVER_CERTIFICATE_DAYS = 825;
const RENEWAL_DAYS_BEFORE_EXPIRY = 30;
const DAY_MILLISECONDS = 24 * 60 * 60_000;

export interface ServingCertificate {
  /** The server's certificate, followed by the authority that issued it when Mirador made it. */
  chain: string;
  key: string;
  /** Mirador's own certificate authority, which joined machines pin; null with the owner's certificate. */
  authority: string | null;
  /** Every host name and IP address the certificate is good for. */
  names: string[];
}

/** What invite links carry, so the joining machine knows the authority it should pin. */
export const authorityFingerprint = (authority: string) => createHash("sha256").update(new X509Certificate(authority).raw).digest("base64url");

/** Names and addresses other devices may reach this machine at; the server certificate covers them all. */
export function namesToCover(addressHost: string | null) {
  const networkAddresses = Object.values(networkInterfaces())
    .flat()
    .filter((network) => network?.family === "IPv4" && !network.internal)
    .map((network) => network!.address);
  const candidates = [...new Set(["localhost", "127.0.0.1", hostname(), localNetworkName(), ...networkAddresses, ...(addressHost ? [addressHost] : [])])];
  return candidates.filter(isCertifiableName);
}

function isCertifiableName(name: string) {
  const certifiable = /^[A-Za-z0-9.-]+$/.test(name);
  if (!certifiable) console.log(`not certifying "${name}": a host name has only letters, digits, - and .`);
  return certifiable;
}

export function namesIn(certificate: string) {
  return (new X509Certificate(certificate).subjectAltName ?? "")
    .split(", ")
    .map((name) => name.replace(/^(DNS|IP Address):/, ""))
    .filter(Boolean);
}

const isIpAddress = (name: string) => /^\d+\.\d+\.\d+\.\d+$/.test(name);
const subjectAltName = (names: string[]) => names.map((name) => (isIpAddress(name) ? `IP:${name}` : `DNS:${name}`)).join(", ");

/** Openssl's config parser expands $name inside values and reads " and \ as quoting; quoting with those escaped keeps any text verbatim. */
export const opensslConfigValue = (value: string) => `"${value.replace(/["\\$]/g, "\\$&")}"`;

/** openssl refuses a common name over 64 characters; clients check the names in subjectAltName, so a long host name is cut. */
const COMMON_NAME_CHARACTERS = 64;
const commonName = (after = "") => `Mirador on ${hostname()}`.slice(0, COMMON_NAME_CHARACTERS - after.length) + after;

/** Git for Windows ships openssl but its installer leaves it off PATH; the native build comes before the MSYS one. */
const GIT_OPENSSL_FOLDERS = [win32.join("mingw64", "bin"), win32.join("usr", "bin")];

export function findOpenssl(
  environment: Record<string, string | undefined> = process.env,
  { platform = process.platform, exists = existsSync, which = onPathOf(environment) }: { platform?: NodeJS.Platform; exists?: (path: string) => boolean; which?: (program: string) => string | null } = {},
) {
  const onPath = which("openssl");
  if (onPath || platform !== "win32") return onPath;
  const inGit = gitInstallFolders(which).flatMap((git) => GIT_OPENSSL_FOLDERS.map((folder) => win32.join(git, folder, "openssl.exe")));
  return inGit.find((openssl) => exists(openssl)) ?? null;
}

export const opensslMissing = (platform = process.platform) =>
  `Mirador needs openssl to make its certificate. ${platform === "win32" ? "Install Git for Windows, which comes with it" : "Install it"}, or give the host a certificate of your own (tlsCertificate and tlsKey).`;

function openssl(directory: string, args: string[]) {
  const program = findOpenssl();
  if (!program) throw new Error(opensslMissing());
  const result = Bun.spawnSync([program, ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`openssl ${args[0]} failed: ${String(result.stderr ?? "").trim()}`);
}

function writePrivately(path: string, text: string) {
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Made here rather than by openssl: LibreSSL writes explicit curve parameters, which Bun's TLS cannot read. */
function writeNewKey(path: string) {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  writePrivately(path, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
}

/** Made once and kept: joined machines pin it, so server certificates it issues later keep working for them. */
function authorityIn(directory: string) {
  const authorityPath = join(directory, "authority.pem");
  if (existsSync(authorityPath)) return readFileSync(authorityPath, "utf8");
  writePrivately(
    join(directory, "authority.cnf"),
    [
      "[req]",
      "distinguished_name = subject",
      "prompt = no",
      "x509_extensions = authority",
      "[subject]",
      `CN = ${opensslConfigValue(commonName(" (certificate authority)"))}`,
      "[authority]",
      "basicConstraints = critical, CA:TRUE, pathlen:0",
      "keyUsage = critical, keyCertSign, cRLSign",
      "subjectKeyIdentifier = hash",
      "",
    ].join("\n"),
  );
  writeNewKey(join(directory, "authority-key.pem"));
  openssl(directory, ["req", "-new", "-x509", "-config", "authority.cnf", "-key", "authority-key.pem", "-days", String(AUTHORITY_DAYS), "-out", "authority.pem"]);
  return readFileSync(authorityPath, "utf8");
}

function serverCertificateStillFits(certificate: string, authority: string, names: string[], now: number) {
  const parsed = new X509Certificate(certificate);
  const covered = new Set(namesIn(certificate));
  return (
    parsed.checkIssued(new X509Certificate(authority)) &&
    Date.parse(parsed.validTo) - now > RENEWAL_DAYS_BEFORE_EXPIRY * DAY_MILLISECONDS &&
    names.every((name) => covered.has(name))
  );
}

function servingPairStillFits(certificate: string, key: string, authority: string, names: string[], now: number) {
  try {
    return new X509Certificate(certificate).checkPrivateKey(createPrivateKey(key)) && serverCertificateStillFits(certificate, authority, names, now);
  } catch {
    return false;
  }
}

function swapInStagedPair(directory: string) {
  // A kill between the renames leaves a mismatch; key first, because the old certificate then usually no longer fits and is reissued.
  renameSync(join(directory, "server-key.pem.staged"), join(directory, "server-key.pem"));
  renameSync(join(directory, "server.pem.staged"), join(directory, "server.pem"));
}

function issueServerCertificate(directory: string, names: string[]) {
  writePrivately(join(directory, "server.cnf"), ["[req]", "distinguished_name = subject", "prompt = no", "[subject]", `CN = ${opensslConfigValue(commonName())}`, ""].join("\n"));
  writePrivately(
    join(directory, "server.ext"),
    [
      "basicConstraints = CA:FALSE",
      "keyUsage = critical, digitalSignature",
      "extendedKeyUsage = serverAuth",
      "authorityKeyIdentifier = keyid",
      `subjectAltName = ${opensslConfigValue(subjectAltName(names))}`,
      "",
    ].join("\n"),
  );
  writeNewKey(join(directory, "server-key.pem.staged"));
  openssl(directory, ["req", "-new", "-config", "server.cnf", "-key", "server-key.pem.staged", "-out", "server.csr"]);
  const serial = `0x${randomBytes(16).toString("hex")}`;
  openssl(directory, ["x509", "-req", "-in", "server.csr", "-CA", "authority.pem", "-CAkey", "authority-key.pem", "-set_serial", serial, "-days", String(SERVER_CERTIFICATE_DAYS), "-extfile", "server.ext", "-out", "server.pem.staged"]);
  swapInStagedPair(directory);
}

/** Mirador's own: a server certificate from its own authority, issued again when it runs out or a name is missing. */
export function ownServingCertificate(dataDir: string, names: string[], now = Date.now()): ServingCertificate {
  const directory = join(dataDir, "tls");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const authority = authorityIn(directory);
  const serverPath = join(directory, "server.pem");
  const keyPath = join(directory, "server-key.pem");
  const fits = existsSync(serverPath) && existsSync(keyPath) && servingPairStillFits(readFileSync(serverPath, "utf8"), readFileSync(keyPath, "utf8"), authority, names, now);
  if (!fits) issueServerCertificate(directory, names);
  const server = readFileSync(serverPath, "utf8");
  return { chain: `${server.trimEnd()}\n${authority}`, key: readFileSync(keyPath, "utf8"), authority, names: namesIn(server) };
}

export function servingCertificate(dataDir: string, names: string[], ownCertificate: { certificatePath: string; keyPath: string } | null): ServingCertificate {
  if (!ownCertificate) return ownServingCertificate(dataDir, names);
  const chain = readFileSync(ownCertificate.certificatePath, "utf8");
  return { chain, key: readFileSync(ownCertificate.keyPath, "utf8"), authority: null, names: namesIn(chain) };
}
