/** Signs JWTs with WebCrypto, whose ECDSA signatures are already the r‖s form JWS wants. */

const base64url = (bytes: ArrayBuffer | Uint8Array | string) => Buffer.from(typeof bytes === "string" ? bytes : new Uint8Array(bytes)).toString("base64url");

function pkcs8Of(pem: string) {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  return Buffer.from(body, "base64");
}

export type JwtAlgorithm = "ES256" | "RS256";

const importParameters: Record<JwtAlgorithm, EcKeyImportParams | RsaHashedImportParams> = {
  ES256: { name: "ECDSA", namedCurve: "P-256" },
  RS256: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
};

const signParameters: Record<JwtAlgorithm, AlgorithmIdentifier | EcdsaParams> = {
  ES256: { name: "ECDSA", hash: "SHA-256" },
  RS256: { name: "RSASSA-PKCS1-v1_5" },
};

export const signingKey = (pem: string, algorithm: JwtAlgorithm) => crypto.subtle.importKey("pkcs8", pkcs8Of(pem), importParameters[algorithm], false, ["sign"]);

export async function signedJwt(key: CryptoKey, algorithm: JwtAlgorithm, header: Record<string, string>, claims: Record<string, string | number>) {
  const unsigned = `${base64url(JSON.stringify({ alg: algorithm, ...header }))}.${base64url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign(signParameters[algorithm], key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(signature)}`;
}
