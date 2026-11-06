import { join } from "node:path";

export const sidecarFileName = (platform: NodeJS.Platform = process.platform) => (platform === "win32" ? "mirador-p2p.exe" : "mirador-p2p");

/** Where a release carries the peer-to-peer sidecar, relative to the Mirador it stages beside host/. */
export const sidecarInMirador = (platform: NodeJS.Platform = process.platform) => join("p2p", sidecarFileName(platform));
