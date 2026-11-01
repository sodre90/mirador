import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createPrivateKey, generateKeyPairSync, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorityFingerprint, findOpenssl, namesIn, namesToCover, opensslMissing, ownServingCertificate, type ServingCertificate } from "../host/certificates.ts";

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "mirador-certificates-"));
});
afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

const DAY = 24 * 60 * 60_000;

async function answersPinnedTo(certificate: ServingCertificate, authority: string, host: string) {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, tls: { cert: certificate.chain, key: certificate.key }, fetch: () => new Response("hello") });
  try {
    const response = await fetch(`https://${host}:${server.port}`, { tls: { ca: authority } });
    return await response.text();
  } finally {
    server.stop(true);
  }
}

test("Mirador's own authority issues a server certificate for every name, which a client pinned to the authority accepts", async () => {
  const certificate = ownServingCertificate(dataDir, ["localhost", "127.0.0.1", "box.local"]);
  expect(certificate.names).toEqual(["localhost", "127.0.0.1", "box.local"]);
  expect(new X509Certificate(certificate.authority!).ca).toBe(true);
  expect(await answersPinnedTo(certificate, certificate.authority!, "localhost")).toBe("hello");
  expect(await answersPinnedTo(certificate, certificate.authority!, "127.0.0.1")).toBe("hello");
  expect(authorityFingerprint(certificate.authority!)).toMatch(/^[\w-]{43}$/);
});

test.skipIf(process.platform === "win32")("the authority's and the server's keys are readable by their owner only", () => {
  ownServingCertificate(dataDir, ["localhost"]);
  ["authority-key.pem", "server-key.pem"].forEach((key) => expect(statSync(join(dataDir, "tls", key)).mode & 0o777).toBe(0o600));
});

test("the server certificate is kept while it fits, and issued again by the same authority for a new name or near its expiry", async () => {
  const first = ownServingCertificate(dataDir, ["localhost"]);
  expect(ownServingCertificate(dataDir, ["localhost"]).chain).toBe(first.chain);

  const withNewName = ownServingCertificate(dataDir, ["localhost", "10.1.2.3"]);
  expect(withNewName.chain).not.toBe(first.chain);
  expect(withNewName.authority).toBe(first.authority);
  expect(namesIn(withNewName.chain)).toEqual(["localhost", "10.1.2.3"]);
  expect(await answersPinnedTo(withNewName, first.authority!, "localhost")).toBe("hello");

  const expiresAt = Date.parse(new X509Certificate(withNewName.chain).validTo);
  const renewed = ownServingCertificate(dataDir, ["localhost"], expiresAt - 10 * DAY);
  expect(renewed.chain).not.toBe(withNewName.chain);
  expect(renewed.authority).toBe(first.authority);
});

test("a client pinned to another authority refuses the server", async () => {
  const certificate = ownServingCertificate(dataDir, ["localhost"]);
  const otherDataDir = mkdtempSync(join(tmpdir(), "mirador-certificates-other-"));
  try {
    const otherAuthority = ownServingCertificate(otherDataDir, ["localhost"]).authority!;
    expect(answersPinnedTo(certificate, otherAuthority, "localhost")).rejects.toThrow();
  } finally {
    rmSync(otherDataDir, { recursive: true, force: true });
  }
});

test("a renewal whose re-signing fails leaves the key on disk matching the certificate on disk", async () => {
  const first = ownServingCertificate(dataDir, ["localhost"]);
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  writeFileSync(join(dataDir, "tls", "authority-key.pem"), privateKey.export({ type: "pkcs8", format: "pem" }).toString());

  expect(() => ownServingCertificate(dataDir, ["localhost", "10.9.8.7"])).toThrow(/openssl x509 failed/);

  expect(readFileSync(join(dataDir, "tls", "server-key.pem"), "utf8")).toBe(first.key);
  const onDisk = {
    chain: `${readFileSync(join(dataDir, "tls", "server.pem"), "utf8").trimEnd()}\n${first.authority}`,
    key: readFileSync(join(dataDir, "tls", "server-key.pem"), "utf8"),
    authority: first.authority!,
    names: [],
  };
  expect(await answersPinnedTo(onDisk, first.authority!, "localhost")).toBe("hello");
});

test("the server certificate lasts at most 825 days, as Apple's platforms require", () => {
  const { chain } = ownServingCertificate(dataDir, ["localhost"]);
  const server = new X509Certificate(chain);
  expect(Date.parse(server.validTo) - Date.parse(server.validFrom)).toBeLessThanOrEqual(825 * DAY);
  expect(readFileSync(join(dataDir, "tls", "authority.pem"), "utf8")).toBe(chain.slice(chain.indexOf("-----BEGIN", 1)));
});

test("host names go into the openssl config quoted, so its variable expansion cannot mangle them", () => {
  ownServingCertificate(dataDir, ["localhost"]);
  for (const config of ["server.cnf", "authority.cnf"]) {
    expect(readFileSync(join(dataDir, "tls", config), "utf8")).toMatch(/^CN = "Mirador on .*"$/m);
  }
});

test("a host name too long for a certificate's common name is cut short there, and the certificate is still made", async () => {
  const machine = "a-rather-long-machine-name.with-several-parts.example.internal";
  const named = spyOn(os, "hostname").mockReturnValue(machine);
  try {
    const certificate = ownServingCertificate(dataDir, ["localhost"]);
    const commonNameOf = (pem: string) => new X509Certificate(pem).subject.replace(/^CN=/, "");
    expect(commonNameOf(certificate.authority!)).toBe(`${`Mirador on ${machine}`.slice(0, 40)} (certificate authority)`);
    expect(commonNameOf(certificate.chain)).toBe(`Mirador on ${machine}`.slice(0, 64));
    expect(await answersPinnedTo(certificate, certificate.authority!, "localhost")).toBe("hello");
  } finally {
    named.mockRestore();
  }
});

test("a host name with a dollar sign is certified as written", () => {
  expect(ownServingCertificate(dataDir, ["localhost", "box$1.example"]).names).toContain("box$1.example");
});

const keyMatchesCertificate = ({ chain, key }: ServingCertificate) => new X509Certificate(chain).checkPrivateKey(createPrivateKey(key));

test("a key that does not match the certificate on disk is replaced with a matching pair", () => {
  const first = ownServingCertificate(dataDir, ["localhost"]);
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  writeFileSync(join(dataDir, "tls", "server-key.pem"), privateKey.export({ type: "pkcs8", format: "pem" }).toString());

  const healed = ownServingCertificate(dataDir, ["localhost"]);

  expect(healed.chain).not.toBe(first.chain);
  expect(keyMatchesCertificate(healed)).toBe(true);
});

test("an empty server.pem left by an old failed renewal is replaced with a matching pair", () => {
  ownServingCertificate(dataDir, ["localhost"]);
  writeFileSync(join(dataDir, "tls", "server.pem"), "");

  expect(keyMatchesCertificate(ownServingCertificate(dataDir, ["localhost"]))).toBe(true);
});

test("names that are not host names are left out of the names to cover, so the host still gets a certificate", () => {
  const logged = spyOn(console, "log").mockImplementation(() => {});
  try {
    const names = namesToCover("box.example,ts.net");
    expect(names).not.toContain("box.example,ts.net");
    expect(namesToCover("it's.example")).not.toContain("it's.example");
    expect(namesToCover("box.example")).toContain("box.example");
    expect(namesToCover("192.168.1.5")).toContain("192.168.1.5");
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("box.example,ts.net"));
    expect(ownServingCertificate(dataDir, names).names).toEqual(names);
  } finally {
    logged.mockRestore();
  }
});

describe("the openssl Mirador makes its certificate with", () => {
  const onPath = (programs: Record<string, string>) => (program: string) => programs[program] ?? null;
  const gitOpenssl = (folder: string) => `C:\\Program Files\\Git\\${folder}\\openssl.exe`;

  test("is the one on PATH, on every platform", () => {
    const which = onPath({ openssl: "C:\\OpenSSL\\bin\\openssl.exe" });
    expect(findOpenssl({}, { platform: "win32", exists: () => true, which })).toBe("C:\\OpenSSL\\bin\\openssl.exe");
    expect(findOpenssl({}, { platform: "darwin", which: onPath({ openssl: "/usr/bin/openssl" }) })).toBe("/usr/bin/openssl");
  });

  test("on Windows without one on PATH, is the one Git for Windows comes with, its native build first", () => {
    expect(findOpenssl({}, { platform: "win32", exists: () => true, which: onPath({}) })).toBe(gitOpenssl("mingw64\\bin"));
    expect(findOpenssl({}, { platform: "win32", exists: (path) => path === gitOpenssl("usr\\bin"), which: onPath({}) })).toBe(gitOpenssl("usr\\bin"));
    const elsewhere = "D:\\Tools\\Git\\mingw64\\bin\\openssl.exe";
    expect(findOpenssl({}, { platform: "win32", exists: (path) => path === elsewhere, which: onPath({ git: "D:\\Tools\\Git\\cmd\\git.exe" }) })).toBe(elsewhere);
  });

  test("is missing without one on PATH, or outside Windows; the reason says what to install", () => {
    expect(findOpenssl({}, { platform: "win32", exists: () => false, which: onPath({}) })).toBeNull();
    expect(findOpenssl({}, { platform: "linux", exists: () => true, which: onPath({}) })).toBeNull();
    expect(opensslMissing("win32")).toBe("Mirador needs openssl to make its certificate. Install Git for Windows, which comes with it, or give the host a certificate of your own (tlsCertificate and tlsKey).");
    expect(opensslMissing("linux")).toBe("Mirador needs openssl to make its certificate. Install it, or give the host a certificate of your own (tlsCertificate and tlsKey).");
  });
});
